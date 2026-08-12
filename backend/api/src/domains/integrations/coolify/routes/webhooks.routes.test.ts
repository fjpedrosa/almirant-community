import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createHmac } from "crypto";
import { Elysia } from "elysia";
import { createLoggerMock } from "../../../../test/mocks";

const child = process.env.ALMIRANT_WEBHOOK_SIGNATURE_TEST === "coolify";
if (!child) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--isolate", import.meta.path],
    env: { ...process.env, ALMIRANT_WEBHOOK_SIGNATURE_TEST: "coolify" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`Coolify child exited ${result.exitCode}`);
}
const register = (path: string, factory: () => unknown) => {
  if (child) mock.module(path, factory);
};
const describeGuarded = child ? describe : (_name: string, _fn: () => void) => {};

const webhookSecret = "coolify-test-secret";
const configMock = createLoggerMock();
const configEnv = { ...configMock.env, COOLIFY_WEBHOOK_SECRET: webhookSecret as string | undefined };
const state = { payloads: [] as Array<Record<string, unknown>> };

register("@almirant/config", () => ({ ...configMock, env: configEnv }));
register("../services/coolify-webhook-handlers", () => ({
  handleCoolifyDeployment: async (payload: Record<string, unknown>) => { state.payloads.push(payload); },
}));

const body = JSON.stringify({ status: "finished", deployment_uuid: "deployment-123" });
const signatureFor = (payload: string): string => createHmac("sha256", webhookSecret).update(payload, "utf8").digest("hex");
const request = (payload: string, signature?: string): Request => new Request("http://localhost/webhooks/coolify", {
  method: "POST",
  headers: { "content-type": "application/json", ...(signature === undefined ? {} : { "x-coolify-signature": signature }) },
  body: payload,
});
const buildApp = async () => {
  const { coolifyWebhooksRoutes } = await import("./webhooks.routes");
  return new Elysia().use(coolifyWebhooksRoutes);
};

describeGuarded("coolifyWebhooksRoutes signature boundary", () => {
  beforeEach(() => { state.payloads = []; configEnv.COOLIFY_WEBHOOK_SECRET = webhookSecret; });

  it("accepts valid HMAC and reaches handleCoolifyDeployment", async () => {
    const response = await (await buildApp()).handle(request(body, signatureFor(body)));
    await Promise.resolve();
    expect(response.status).toBe(200);
    expect(state.payloads).toEqual([JSON.parse(body)]);
  });

  it("rejects malformed bodies before parsing when credentials or signature fail", async () => {
    const malformed = "{not-json";
    configEnv.COOLIFY_WEBHOOK_SECRET = undefined;
    const missingCredentials = await (await buildApp()).handle(request(malformed, signatureFor(malformed)));
    configEnv.COOLIFY_WEBHOOK_SECRET = webhookSecret;
    const missingSignature = await (await buildApp()).handle(request(malformed));
    const malformedSignature = await (await buildApp()).handle(request(malformed, "zz".repeat(32)));
    expect(missingCredentials.status).toBe(401);
    expect(missingSignature.status).toBe(401);
    expect(malformedSignature.status).toBe(401);
    expect(state.payloads).toHaveLength(0);
  });

  it("parses malformed JSON only after successful HMAC authentication", async () => {
    const malformed = "{not-json";
    const response = await (await buildApp()).handle(request(malformed, signatureFor(malformed)));
    expect(response.status).toBe(400);
    expect(state.payloads).toHaveLength(0);
  });
});
