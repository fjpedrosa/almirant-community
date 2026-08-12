import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createHmac } from "crypto";
import { Elysia } from "elysia";
import { createDatabaseMocks, createLoggerMock } from "../../../../test/mocks";

const child = process.env.ALMIRANT_WEBHOOK_SIGNATURE_TEST === "github";
if (!child) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--isolate", import.meta.path],
    env: { ...process.env, ALMIRANT_WEBHOOK_SIGNATURE_TEST: "github" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`GitHub child exited ${result.exitCode}`);
}
const register = (path: string, factory: () => unknown) => {
  if (child) mock.module(path, factory);
};
const describeGuarded = child ? describe : (_name: string, _fn: () => void) => {};

const webhookSecret = "github-test-secret";
const configMock = createLoggerMock();
const state = { events: [] as Array<{ name: string; payload: unknown; deliveryId: string }> };
const record = (name: string) => async (payload: unknown, deliveryId: string) => {
  state.events.push({ name, payload, deliveryId });
};

register("@almirant/config", () => configMock);
register("@almirant/database", () => createDatabaseMocks());
register("../../../instance/services/github-app-credentials-service", () => ({
  getGithubAppCredentials: async () => ({
    source: "env",
    credentials: { appId: "app-id", slug: "app-slug", clientId: "client-id", clientSecret: "client-secret", webhookSecret, privateKeyPem: "private-key" },
  }),
}));
register("../services/github-webhook-handlers", () => ({
  handlePushEvent: record("push"),
  handlePullRequestEvent: record("pull_request"),
  handlePullRequestReviewEvent: record("pull_request_review"),
  handleCheckRunEvent: record("check_run"),
  handleWorkflowRunEvent: record("workflow_run"),
  handleInstallationEvent: record("installation"),
}));

const body = JSON.stringify({ ref: "refs/heads/main", commits: [] });
const signatureFor = (payload: string): string => `sha256=${createHmac("sha256", webhookSecret).update(payload, "utf8").digest("hex")}`;
const request = (payload: string, signature?: string): Request => new Request("http://localhost/webhooks/github", {
  method: "POST",
  headers: { "content-type": "application/json", "x-github-event": "push", "x-github-delivery": "delivery-123", ...(signature ? { "x-hub-signature-256": signature } : {}) },
  body: payload,
});
const buildApp = async () => {
  const { githubWebhooksRoutes } = await import("./webhooks.routes");
  return new Elysia().use(githubWebhooksRoutes);
};

describeGuarded("githubWebhooksRoutes signature boundary", () => {
  beforeEach(() => { state.events = []; });

  it("uses the supplied raw body and signature to reach the matching event handler", async () => {
    const response = await (await buildApp()).handle(request(body, signatureFor(body)));
    await Promise.resolve();
    expect(response.status).toBe(200);
    expect(state.events).toEqual([{ name: "push", payload: JSON.parse(body), deliveryId: "delivery-123" }]);
  });

  it("rejects malformed bodies before parsing when authentication fails", async () => {
    const malformed = "{not-json";
    const missing = await (await buildApp()).handle(request(malformed));
    const mismatchedBodySignature = await (await buildApp()).handle(request(malformed, signatureFor(`${malformed} changed`)));
    expect(missing.status).toBe(401);
    expect(mismatchedBodySignature.status).toBe(401);
    expect(state.events).toHaveLength(0);
  });

  it("reaches parsing after valid authentication with current route semantics", async () => {
    const malformed = "{not-json";
    const response = await (await buildApp()).handle(request(malformed, signatureFor(malformed)));
    expect(response.status).toBe(500);
    expect(state.events).toHaveLength(0);
  });
});
