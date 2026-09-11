import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { ServerResponse, request as httpRequest } from "node:http";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
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
const AUTH_TOKEN = Buffer.alloc(32, 11).toString("base64url");

describe("createShimServer", () => {
  let currentServer: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
  } | null = null;

  afterEach(async () => {
    await currentServer?.stop();
    currentServer = null;
  });

  it("rejects a missing bearer before reaching the adapter", async () => {
    const adapter = createAdapter();
    const list = spyOn(adapter, "listSessions");
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter, host: "127.0.0.1", port, authToken: AUTH_TOKEN, logger: quietLogger,
    });
    await currentServer.start();

    const response = await fetch(`http://127.0.0.1:${port}/session`);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":"Unauthorized"}');
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects invalid bearers on every control route before parsing bodies or calling adapters", async () => {
    const adapter = createAdapter({ async abortSession() { return true; } });
    const calls = (["createSession", "listSessions", "getSession", "deleteSession",
      "sendPrompt", "abortSession"] as const).map((method) => spyOn(adapter, method));
    const logged: unknown[] = [];
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter, host: "127.0.0.1", port, authToken: AUTH_TOKEN,
      logger: { info: (...args) => logged.push(args), error: (...args) => logged.push(args) },
    });
    await currentServer.start();
    const otherToken = Buffer.alloc(32, 12).toString("base64url");
    // Static protocol/route matrix from reference tree 32a7844e; no activation wiring.
    const routes = [
      ["GET", "/session"], ["POST", "/session"],
      ["GET", "/session/session-1"], ["DELETE", "/session/session-1"],
      ["POST", "/session/session-1/abort"], ["POST", "/session/session-1/message"],
      ["POST", "/session/session-1/prompt_async"],
      ["GET", "/event"], ["GET", "/session/session-1/event"],
      ["POST", "/control/activate"], ["GET", "/unknown"],
    ] as const;
    for (const authorization of [undefined, "", AUTH_TOKEN, `Bearer ${otherToken}`,
      `bearer ${AUTH_TOKEN}`, `BEARER ${AUTH_TOKEN}`, `Bearer  ${AUTH_TOKEN}`,
      `Bearer\t${AUTH_TOKEN}`, `Bearer ${AUTH_TOKEN}=`,
      `Bearer ${AUTH_TOKEN}, Bearer ${AUTH_TOKEN}`]) {
      for (const [method, path] of routes) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          method, redirect: "manual",
          headers: { "content-type": "application/json",
            ...(authorization === undefined ? {} : { authorization }) },
          // Invalid JSON proves authentication precedes body parsing.
          ...(method === "POST" ? { body: "{" } : {}),
        });
        expect(response.status).toBe(401);
        expect(await response.text()).toBe('{"error":"Unauthorized"}');
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(JSON.stringify([...response.headers])).not.toContain(AUTH_TOKEN);
        expect(JSON.stringify([...response.headers])).not.toContain(otherToken);
      }
    }
    const oversized = await fetch(`http://127.0.0.1:${port}/session`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x".repeat(1_048_576) }),
    });
    expect(oversized.status).toBe(401);
    expect(await oversized.text()).toBe('{"error":"Unauthorized"}');
    for (const call of calls) expect(call).not.toHaveBeenCalled();
    for (const path of ["/health/live", "/health/ready"]) {
      for (const authorization of [undefined, "malformed"]) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          headers: authorization ? { authorization } : {},
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(path.endsWith("live") ? { ok: true } : { ready: true });
      }
    }
    expect(JSON.stringify(logged)).not.toContain(AUTH_TOKEN);
    expect(JSON.stringify(logged)).not.toContain(otherToken);
    expect(inspect(currentServer, { showHidden: true })).not.toContain(AUTH_TOKEN);
    expect(JSON.stringify(currentServer)).not.toContain(AUTH_TOKEN);
  });

  it("rejects duplicate authorization fields even when the first bearer is correct", async () => {
    const port = await getFreePort();
    const adapter = createAdapter();
    const list = spyOn(adapter, "listSessions");
    currentServer = createShimServer({
      adapter, host: "127.0.0.1", port, authToken: AUTH_TOKEN, logger: quietLogger,
    });
    await currentServer.start();
    for (const values of [[`Bearer ${AUTH_TOKEN}`, "wrong"],
      ["wrong", `Bearer ${AUTH_TOKEN}`], [`Bearer ${AUTH_TOKEN}`, `Bearer ${AUTH_TOKEN}`]]) {
      // fetch coalesces duplicate fields; node:http preserves them on the wire.
      const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        const request = httpRequest({ host: "127.0.0.1", port, path: "/session",
          headers: ["Host", "127.0.0.1", "Authorization", values[0]!, "aUtHoRiZaTiOn", values[1]!] }, (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, body }));
          res.on("error", reject);
        });
        request.on("error", reject);
        request.setTimeout(1_000, () => request.destroy(new Error("HTTP test timed out")));
        request.end();
      });
      expect(response).toEqual({ status: 401, body: '{"error":"Unauthorized"}' });
    }
    expect(list).not.toHaveBeenCalled();
  });

  it.each(["disabled", "static"] as const)("preserves every route in %s mode", async (mode) => {
    const authToken = mode === "static" ? AUTH_TOKEN : undefined;
    const port = await getFreePort();
    let listener: RuntimeEventListener = () => {};
    const adapter = createAdapter({
      onEvent(callback) { listener = callback; return () => {}; },
      async sendPrompt(sessionId) { listener({ type: "session.idle", properties: { sessionId } }); },
      async abortSession() { return true; },
    });
    const prompt = spyOn(adapter, "sendPrompt");
    currentServer = createShimServer({
      adapter, host: "127.0.0.1", port, authToken, logger: quietLogger,
    });
    await currentServer.start();
    const baseUrl = `http://127.0.0.1:${port}`;
    const request = (path: string, method = "GET", body?: string) => fetch(`${baseUrl}${path}`, {
      method, body, redirect: "manual", headers: {
        authorization: authToken ? `Bearer ${authToken}` : "malformed but ignored",
        "content-type": "application/json",
      },
    });
    const created = await request("/session", "POST", "{}");
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ id: "session-1", cwd: "/workspace" });
    const list = await request("/session");
    expect(list.status).toBe(200);
    expect(await list.json()).toHaveLength(1);
    const session = await request("/session/session-1");
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ id: "session-1" });
    const message = await request("/session/session-1/message", "POST", '{"prompt":"hello"}');
    expect(message.status).toBe(200);
    expect(await message.json()).toEqual({ success: true });
    expect((await request("/session/session-1/prompt_async", "POST", '{"prompt":"async"}')).status).toBe(204);
    const aborted = await request("/session/session-1/abort", "POST");
    expect(aborted.status).toBe(200);
    expect(await aborted.json()).toBe(true);
    expect(prompt.mock.calls).toEqual([
      ["session-1", { parts: [{ type: "text", text: "hello" }] }],
      ["session-1", { parts: [{ type: "text", text: "async" }] }],
    ]);
    const redirect = await request("/session/session-1/event");
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe("/event");
    expect(new URL(redirect.headers.get("location")!, baseUrl).origin).toBe(baseUrl);
    const events = await request("/event");
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const reader = events.body!.getReader();
    try {
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain('data: {"type":"server.connected"');
    } finally { await reader.cancel(); }
    expect((await request("/session/session-1", "DELETE")).status).toBe(204);
    expect((await request("/control/activate", "POST")).status).toBe(404);
  });

  it("rejects invalid static configuration during construction without side effects or secret leakage", () => {
    const adapter = createAdapter();
    const listen = spyOn(adapter, "onEvent");
    const logged: unknown[] = [];
    for (const authToken of [null, 123, {}, [], new String(AUTH_TOKEN),
      { toString() { throw new Error(AUTH_TOKEN); } }, "", "invalid", `${AUTH_TOKEN}=`,
      ` ${AUTH_TOKEN}`, `${AUTH_TOKEN}\n`, "a".repeat(1_000_000),
      `${AUTH_TOKEN.slice(0, -1)}t`]) {
      let caught: unknown;
      try {
        currentServer = createShimServer({
          adapter, authToken: authToken as string,
          logger: { info: (...args) => logged.push(args), error: (...args) => logged.push(args) },
        });
      } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("Invalid control authentication configuration");
      expect((caught as Error).cause).toBeUndefined();
      expect(inspect(caught, { showHidden: true })).not.toContain(AUTH_TOKEN);
      expect(JSON.stringify(caught)).not.toContain(AUTH_TOKEN);
    }
    expect(listen).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });

  it("keeps auth dormant in every tracked production shim caller", () => {
    const root = new URL("../../../../../", import.meta.url);
    const callers = spawnSync("git", ["grep", "-l", "-E", "createShimServer|shim-server.*server", "--",
      "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs", ":!*.test.*", ":!*.spec.*",
      ":!services/runner/docker/shim-server/src/server.ts"], { cwd: root, encoding: "utf8" });
    expect(callers.status).toBe(0);
    expect(callers.stderr).toBe("");
    const paths = callers.stdout.trim().split("\n");
    expect(paths).toEqual([
      "services/runner-claude/shim/src/index.ts",
      "services/runner/docker/codex-shim/src/index.ts",
      "services/runner/docker/opencode-shim/src/index.ts",
      "services/runner/docker/pi-shim/src/index.ts",
    ]);
    for (const path of paths) {
      const source = readFileSync(new URL(path, root), "utf8");
      expect(source).not.toMatch(/authToken|bootstrapToken/);
      // Exact existing argument shape also excludes indirect/spread configuration.
      expect(source.match(/createShimServer\(([\s\S]*?)\);/)?.[1]?.replace(/\s/g, ""))
        .toBe("{adapter,host,port,heartbeatIntervalMs:15_000,}");
    }
    const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.env|Bun\.env|bootstrapToken|\.activate\(/);
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

  it.each(["disabled", "static"] as const)("keeps health public and rejects non-health admission while draining in %s mode", async (mode) => {
    const closeStarted = createDeferred();
    const allowClose = createDeferred();
    const authToken = mode === "static" ? AUTH_TOKEN : undefined;
    let closeCalls = 0;
    let eventListenerStops = 0;
    let canonicalListenerStops = 0;
    let nativeListenerStops = 0;

    const port = await getFreePort();
    currentServer = createShimServer({
      authToken,
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

      const rejected = await fetch(`${baseUrl}/session`, {
        headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      });
      expect(rejected.status).toBe(503);
      if (authToken) {
        const unauthorized = await fetch(`${baseUrl}/session`);
        expect(unauthorized.status).toBe(401);
        expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });
      }
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
