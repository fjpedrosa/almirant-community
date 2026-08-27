import { afterEach, describe, expect, it } from "bun:test";
import { ServerResponse } from "node:http";
import net from "node:net";
import { createShimServer } from "./server.js";
import type { RuntimeAdapter, RuntimeEventListener } from "./adapter.js";
import type {
  PromptRequest,
  SessionCreateInput,
  SessionCreateResponse,
} from "./types.js";

const getFreePort = async (): Promise<number> => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate test port");
  }
  return address.port;
};

const closeNetServer = async (server: net.Server): Promise<void> => {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
};

const createDeferred = (): {
  promise: Promise<void>;
  resolve: () => void;
} => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const createAdapter = (
  overrides: Partial<RuntimeAdapter> = {},
): RuntimeAdapter => {
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
    ...overrides,
  };
};

const quietLogger = { info: () => {}, error: () => {} };

describe("createShimServer", () => {
  let currentServer: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
  } | null = null;

  afterEach(async () => {
    await currentServer?.stop();
    currentServer = null;
  });

  it("preserves the Community default session cwd when the create body omits cwd", async () => {
    const captured: SessionCreateInput[] = [];
    const adapter = createAdapter();
    const originalCreateSession = adapter.createSession.bind(adapter);
    adapter.createSession = async (input: SessionCreateInput) => {
      captured.push(input);
      return originalCreateSession(input);
    };

    const port = await getFreePort();
    currentServer = createShimServer({
      adapter,
      host: "127.0.0.1",
      port,
      heartbeatIntervalMs: 60_000,
      logger: quietLogger,
    });
    await currentServer.start();

    const created = await fetch(`http://127.0.0.1:${port}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(created.status).toBe(200);
    expect(captured[0]?.cwd).toBe("/workspace");
  });

  it("deletes sessions through the OpenCode-compatible session route", async () => {
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter(),
      host: "127.0.0.1",
      port,
      heartbeatIntervalMs: 60_000,
      logger: quietLogger,
    });
    await currentServer.start();

    const baseUrl = `http://127.0.0.1:${port}`;
    const created = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/workspace/repo" }),
    });
    expect(created.status).toBe(200);

    const deleted = await fetch(`${baseUrl}/session/session-1`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);

    const lookup = await fetch(`${baseUrl}/session/session-1`);
    expect(lookup.status).toBe(404);
  });

  it("returns a boolean from the abort route and 404 for missing or unsupported sessions", async () => {
    const supportedPort = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter({
        async abortSession(sessionId) {
          return sessionId === "session-1";
        },
      }),
      host: "127.0.0.1",
      port: supportedPort,
      heartbeatIntervalMs: 60_000,
      logger: quietLogger,
    });
    await currentServer.start();

    const supportedBaseUrl = `http://127.0.0.1:${supportedPort}`;
    const aborted = await fetch(`${supportedBaseUrl}/session/session-1/abort`, {
      method: "POST",
    });
    expect(aborted.status).toBe(200);
    expect(await aborted.json()).toBe(true);

    const missing = await fetch(`${supportedBaseUrl}/session/missing/abort`, {
      method: "POST",
    });
    expect(missing.status).toBe(404);

    await currentServer.stop();
    currentServer = null;

    const unsupportedPort = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter(),
      host: "127.0.0.1",
      port: unsupportedPort,
      heartbeatIntervalMs: 60_000,
      logger: quietLogger,
    });
    await currentServer.start();

    const unsupported = await fetch(
      `http://127.0.0.1:${unsupportedPort}/session/session-1/abort`,
      { method: "POST" },
    );
    expect(unsupported.status).toBe(404);
  });

  it("reports liveness and readiness, then rejects non-health admission while draining", async () => {
    const closeStarted = createDeferred();
    const allowClose = createDeferred();
    let closeCalls = 0;
    let eventListenerStops = 0;
    let canonicalListenerStops = 0;
    let nativeListenerStops = 0;

    const port = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter({
        onEvent() {
          return () => {
            eventListenerStops += 1;
          };
        },
        onCanonicalEvent() {
          return () => {
            canonicalListenerStops += 1;
          };
        },
        onNativeEvent() {
          return () => {
            nativeListenerStops += 1;
          };
        },
        async close() {
          closeCalls += 1;
          closeStarted.resolve();
          await allowClose.promise;
        },
      }),
      host: "127.0.0.1",
      port,
      heartbeatIntervalMs: 60_000,
      logger: quietLogger,
    });
    await currentServer.start();

    const baseUrl = `http://127.0.0.1:${port}`;
    const live = await fetch(`${baseUrl}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ ok: true });

    const ready = await fetch(`${baseUrl}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ready: true });

    const firstStop = currentServer.stop();
    const secondStop = currentServer.stop();
    await closeStarted.promise;

    try {
      const drainingLive = await fetch(`${baseUrl}/health/live`);
      expect(drainingLive.status).toBe(200);
      expect(await drainingLive.json()).toEqual({ ok: true });

      const drainingReady = await fetch(`${baseUrl}/health/ready`);
      expect(drainingReady.status).toBe(503);
      expect(await drainingReady.json()).toEqual({ ready: false });

      const rejected = await fetch(`${baseUrl}/session`);
      expect(rejected.status).toBe(503);
    } finally {
      allowClose.resolve();
      await Promise.allSettled([firstStop, secondStop]);
    }

    expect(closeCalls).toBe(1);
    expect(eventListenerStops).toBe(1);
    expect(canonicalListenerStops).toBe(1);
    expect(nativeListenerStops).toBe(1);
  });

  it("bounds a hung adapter close independently and still closes the HTTP listener", async () => {
    const neverCloses = createDeferred();
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter({
        async close() {
          await neverCloses.promise;
        },
      }),
      host: "127.0.0.1",
      port,
      heartbeatIntervalMs: 60_000,
      adapterCloseTimeoutMs: 20,
      httpCloseTimeoutMs: 100,
      logger: quietLogger,
    });
    await currentServer.start();

    const stopping = currentServer.stop();
    currentServer = null;
    const error = await stopping.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "SHIM_ADAPTER_CLOSE_TIMEOUT" });
    expect(String(error)).not.toContain("WORKSPACE_REPO_PATH");

    const listenerClosed = await fetch(`http://127.0.0.1:${port}/health/live`)
      .then(() => false)
      .catch(() => true);
    expect(listenerClosed).toBe(true);
    neverCloses.resolve();
  });

  it("bounds HTTP close independently when an admitted request never settles", async () => {
    const listStarted = createDeferred();
    const allowList = createDeferred();
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter({
        async listSessions() {
          listStarted.resolve();
          await allowList.promise;
          return [];
        },
      }),
      host: "127.0.0.1",
      port,
      heartbeatIntervalMs: 60_000,
      adapterCloseTimeoutMs: 100,
      httpCloseTimeoutMs: 20,
      logger: quietLogger,
    });
    await currentServer.start();

    const inflightRequest = fetch(`http://127.0.0.1:${port}/session`).catch(
      () => null,
    );
    await listStarted.promise;
    const stopping = currentServer.stop();
    currentServer = null;
    const error = await stopping.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "SHIM_HTTP_CLOSE_TIMEOUT" });

    allowList.resolve();
    await inflightRequest;
  });

  it("sanitizes adapter close failures instead of exposing raw details", async () => {
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter({
        async close() {
          throw new Error("command=/private/tool token=raw-secret");
        },
      }),
      host: "127.0.0.1",
      port,
      heartbeatIntervalMs: 60_000,
      logger: quietLogger,
    });
    await currentServer.start();

    const stopping = currentServer.stop();
    currentServer = null;
    const error = await stopping.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "SHIM_ADAPTER_CLOSE_FAILED" });
    expect(String(error)).not.toMatch(/private\/tool|raw-secret/);
  });

  it("rejects listen errors, cleans state, and can start successfully on retry", async () => {
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    if (!address || typeof address === "string") {
      await closeNetServer(blocker);
      throw new Error("Could not allocate occupied test port");
    }

    currentServer = createShimServer({
      adapter: createAdapter(),
      host: "127.0.0.1",
      port: address.port,
      heartbeatIntervalMs: 60_000,
      logger: quietLogger,
    });

    try {
      await expect(currentServer.start()).rejects.toThrow(
        /EADDRINUSE|listen|port .* in use/i,
      );
      await closeNetServer(blocker);

      await currentServer.start();
      const ready = await fetch(
        `http://127.0.0.1:${address.port}/health/ready`,
      );
      expect(ready.status).toBe(200);
    } finally {
      await closeNetServer(blocker);
    }
  });

  it("ends SSE clients during stop", async () => {
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter(),
      host: "127.0.0.1",
      port,
      heartbeatIntervalMs: 60_000,
      logger: quietLogger,
    });
    await currentServer.start();

    const response = await fetch(`http://127.0.0.1:${port}/event`);
    expect(response.status).toBe(200);
    const body = response.text();

    await currentServer.stop();
    expect(await body).toContain("event: message\n");
  });

  it("evicts and ends an SSE client when a write reports backpressure", async () => {
    type ResponseWrite = (
      this: ServerResponse,
      chunk: unknown,
      ...args: unknown[]
    ) => boolean;
    const responsePrototype = ServerResponse.prototype as unknown as {
      write: ResponseWrite;
    };
    const originalWrite = responsePrototype.write;
    responsePrototype.write = function patchedWrite(chunk, ...args) {
      const result = Reflect.apply(originalWrite, this, [chunk, ...args]) as boolean;
      return String(chunk).startsWith("event: message") ? false : result;
    };

    const controller = new AbortController();
    try {
      const port = await getFreePort();
      currentServer = createShimServer({
        adapter: createAdapter(),
        host: "127.0.0.1",
        port,
        heartbeatIntervalMs: 60_000,
        logger: quietLogger,
      });
      await currentServer.start();

      const response = await fetch(`http://127.0.0.1:${port}/event`, {
        signal: controller.signal,
      });
      const outcome = await Promise.race([
        response.text().then((text) => ({ state: "ended" as const, text })),
        new Promise<{ state: "open" }>((resolve) =>
          setTimeout(() => resolve({ state: "open" }), 200),
        ),
      ]);

      expect(outcome.state).toBe("ended");
      if (outcome.state === "ended") {
        expect(outcome.text).toContain("event: message\n");
        expect(outcome.text).toContain('data: {"type":"server.connected"');
      }
    } finally {
      controller.abort();
      responsePrototype.write = originalWrite;
    }
  });
});
