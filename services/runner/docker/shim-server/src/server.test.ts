import { afterEach, describe, expect, it } from "bun:test";
import net from "node:net";
import { createShimServer } from "./server.js";
import type { RuntimeAdapter, RuntimeEventListener } from "./adapter.js";
import type { PromptRequest, SessionCreateInput, SessionCreateResponse } from "./types.js";

const getFreePort = async (): Promise<number> => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate test port");
  }
  return address.port;
};

const createAdapter = (): RuntimeAdapter => {
  const sessions = new Map<string, SessionCreateResponse>();
  return {
    async createSession(input: SessionCreateInput) {
      const session = { id: "session-1", status: "idle", cwd: input.cwd };
      sessions.set(session.id, session);
      return session;
    },
    async sendPrompt(_sessionId: string, _request: PromptRequest) {},
    onEvent(_listener: RuntimeEventListener) {
      return () => {};
    },
    async getSession(sessionId: string) {
      return sessions.get(sessionId) ?? null;
    },
    async listSessions() {
      return Array.from(sessions.values());
    },
    async deleteSession(sessionId: string) {
      return sessions.delete(sessionId);
    },
  };
};

describe("createShimServer", () => {
  let currentServer: { start: () => Promise<void>; stop: () => Promise<void> } | null = null;

  afterEach(async () => {
    await currentServer?.stop();
    currentServer = null;
  });

  it("deletes sessions through the OpenCode-compatible session route", async () => {
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter(),
      host: "127.0.0.1",
      port,
      heartbeatIntervalMs: 60_000,
      logger: { info: () => {}, error: () => {} },
    });
    await currentServer?.start();

    const baseUrl = `http://127.0.0.1:${port}`;
    const created = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/workspace/repo" }),
    });
    expect(created.status).toBe(200);

    const deleted = await fetch(`${baseUrl}/session/session-1`, { method: "DELETE" });
    expect(deleted.status).toBe(204);

    const lookup = await fetch(`${baseUrl}/session/session-1`);
    expect(lookup.status).toBe(404);
  });
});
