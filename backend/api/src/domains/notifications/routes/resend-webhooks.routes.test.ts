import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createHmac } from "crypto";
import { Elysia } from "elysia";
import { createLoggerMock } from "../../../test/mocks";

const child = process.env.ALMIRANT_WEBHOOK_SIGNATURE_TEST === "resend";
if (!child) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--isolate", import.meta.path],
    env: { ...process.env, ALMIRANT_WEBHOOK_SIGNATURE_TEST: "resend" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`Resend child exited ${result.exitCode}`);
}
const register = (path: string, factory: () => unknown) => {
  if (child) mock.module(path, factory);
};
const describeGuarded = child ? describe : (_name: string, _fn: () => void) => {};

const configMock = createLoggerMock();
const configEnv = {
  ...configMock.env,
  RESEND_WEBHOOK_SECRET: `whsec_${Buffer.from("resend-test-secret").toString("base64")}`,
};
const state = { updates: [] as Array<{ emailId: string; status: string }> };

register("@almirant/config", () => ({ ...configMock, env: configEnv }));
register("@almirant/database", () => ({
  updateThankYouDeliveryStatus: async (emailId: string, status: string) => {
    state.updates.push({ emailId, status });
    return true;
  },
}));

const body = JSON.stringify({ type: "email.delivered", data: { email_id: "email-123" } });
const svixHeaders = (payload: string, signatures = 1): Record<string, string> => {
  const id = "msg-123";
  const timestamp = "1710000000";
  const digest = createHmac("sha256", Buffer.from("resend-test-secret"))
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  const values = signatures > 1 ? [`v1,not-the-signature`, `v1,${digest}`] : [`v1,${digest}`];
  return { "content-type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": values.join(" ") };
};
const request = (payload: string, headers: Record<string, string> = {}): Request =>
  new Request("http://localhost/webhooks/resend/delivery", { method: "POST", headers, body: payload });
const buildApp = async () => {
  const { resendWebhooksRoutes } = await import("./resend-webhooks.routes");
  return new Elysia().use(resendWebhooksRoutes);
};

describeGuarded("resendWebhooksRoutes signature boundary", () => {
  beforeEach(() => { state.updates = []; });

  it("accepts valid Svix signatures, including multiple v1 entries", async () => {
    const response = await (await buildApp()).handle(request(body, svixHeaders(body, 2)));
    expect(response.status).toBe(200);
    expect(state.updates).toEqual([{ emailId: "email-123", status: "delivered" }]);
  });

  it("rejects malformed bodies before parsing when authentication fails", async () => {
    const malformed = "{not-json";
    const missing = await (await buildApp()).handle(request(malformed));
    const invalid = await (await buildApp()).handle(request(malformed, { ...svixHeaders(malformed), "svix-signature": "v1,invalid" }));
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(state.updates).toHaveLength(0);
  });

  it("parses malformed JSON only after successful authentication", async () => {
    const malformed = "{not-json";
    const response = await (await buildApp()).handle(request(malformed, svixHeaders(malformed)));
    expect(response.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});
