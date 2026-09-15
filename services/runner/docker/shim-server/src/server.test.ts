import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { ServerResponse, request as httpRequest } from "node:http";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import net from "node:net";
import { createShimServer } from "./server.js";
import * as controlAuthModule from "./control-auth.js";
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
const BOOTSTRAP_TOKEN = Buffer.alloc(32, 12).toString("base64url");
const ACTIVE_TOKEN = Buffer.alloc(32, 13).toString("base64url");

describe("createShimServer", () => {
  let currentServer: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
  } | null = null;

  afterEach(async () => {
    await currentServer?.stop();
    currentServer = null;
  });

  it("rejects invalid external-origin configuration generically before adapter registration", () => {
    const adapter = createAdapter();
    const listen = spyOn(adapter, "onEvent");
    const logged: unknown[] = [];
    const logger = { info: (...args: unknown[]) => logged.push(args), error: (...args: unknown[]) => logged.push(args) };
    const invalid: unknown[] = [null, 0, 1, "false", "true", AUTH_TOKEN, {}, [], new Boolean(true),
      { toString() { throw new Error(AUTH_TOKEN); }, valueOf() { throw new Error(AUTH_TOKEN); } }];
    for (const requireExternalControlOrigin of invalid) {
      for (const auth of [{}, { authToken: AUTH_TOKEN }, { bootstrapToken: BOOTSTRAP_TOKEN }]) {
        let caught: unknown;
        try {
          currentServer = createShimServer({ adapter, logger, ...auth,
            requireExternalControlOrigin: requireExternalControlOrigin as boolean });
        } catch (error) { caught = error; }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toBe("Invalid control authentication configuration");
        expect((caught as Error).cause).toBeUndefined();
        expect(inspect(caught, { showHidden: true })).not.toContain(AUTH_TOKEN);
        expect(JSON.stringify(caught)).toBe("{}");
      }
    }
    expect(listen).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });

  it("rejects external-origin enforcement without authentication", () => {
    const adapter = createAdapter();
    const listen = spyOn(adapter, "onEvent");
    expect(() => createShimServer({ adapter, logger: quietLogger, requireExternalControlOrigin: true }))
      .toThrow("Invalid control authentication configuration");
    expect(listen).not.toHaveBeenCalled();
  });

  it("accepts the external-origin boolean/auth configuration matrix", async () => {
    for (const requireExternalControlOrigin of [undefined, false, true]) {
      for (const auth of [{}, { authToken: AUTH_TOKEN }, { bootstrapToken: BOOTSTRAP_TOKEN }]) {
        if (requireExternalControlOrigin === true && !("authToken" in auth || "bootstrapToken" in auth)) continue;
        currentServer = createShimServer({ adapter: createAdapter(), logger: quietLogger,
          ...auth, requireExternalControlOrigin });
        expect(JSON.stringify(currentServer)).toBe("{}");
        await currentServer.stop();
        currentServer = null;
      }
    }
  });

  it.each(["static", "bootstrap", "active"] as const)("denies direct loopback before credentials on every route in external-origin %s mode", async (mode) => {
    const adapter = createAdapter({ async abortSession() { return true; } });
    const calls = (["createSession", "listSessions", "getSession", "deleteSession",
      "sendPrompt", "abortSession"] as const).map((method) => spyOn(adapter, method));
    const logged: unknown[] = [];
    const logs = (["log", "info", "warn", "error", "debug", "trace"] as const)
      .map((method) => spyOn(console, method).mockImplementation((...args) => { logged.push(args); }));
    const originalCreateAuth = controlAuthModule.createControlAuth;
    let auth!: controlAuthModule.ControlAuth;
    // Observe real auth at its factory boundary. Only active-mode setup seeds the
    // real state machine directly: no fake external socket or production bypass.
    const factory = spyOn(controlAuthModule, "createControlAuth").mockImplementation((config) => {
      auth = { ...originalCreateAuth(config) };
      return auth;
    });
    try {
      const port = await getFreePort();
      currentServer = createShimServer({ adapter, host: "127.0.0.1", port,
        requireExternalControlOrigin: true,
        ...(mode === "static" ? { authToken: AUTH_TOKEN } : { bootstrapToken: BOOTSTRAP_TOKEN }),
        logger: { info: (...args) => logged.push(args), error: (...args) => logged.push(args) } });
      if (mode === "active") {
        expect(auth.activate(`Bearer ${BOOTSTRAP_TOKEN}`, ACTIVE_TOKEN)).toEqual({ status: "activated" });
      }
      const authorize = spyOn(auth, "authorize");
      const activate = spyOn(auth, "activate");
      await currentServer.start();
      expect(logged).toEqual([[`[shim-server] listening on http://127.0.0.1:${port}`]]);
      logged.length = 0; // Preserve the existing listener diagnostic, not a peer log.
      const baseUrl = `http://127.0.0.1:${port}`;
      // Route provenance: 32a7844e:services/runner/docker/shim-server/src/server.ts.
      const routes = [["GET", "/session"], ["POST", "/session"],
        ["GET", "/session/session-1"], ["DELETE", "/session/session-1"],
        ["POST", "/session/session-1/abort"], ["POST", "/session/session-1/message"],
        ["POST", "/session/session-1/prompt_async"], ["GET", "/event"],
        ["GET", "/session/session-1/event"], ["POST", "/control/activate"], ["GET", "/unknown"]] as const;
      const spoofed = { "X-Forwarded-For": "172.18.0.1", Forwarded: 'for="[2001:db8::1]"',
        Host: "external.invalid", Origin: "https://external.invalid", "X-Real-IP": "10.0.0.1" };
      for (const spoof of [false, true]) {
        for (const token of [undefined, "wrong", AUTH_TOKEN, BOOTSTRAP_TOKEN, ACTIVE_TOKEN]) {
          for (const [method, path] of routes) {
            const response = await fetch(`${baseUrl}${path}`, { method, redirect: "manual",
              signal: AbortSignal.timeout(1_000), headers: { "content-type": "application/json",
                "X-Almirant-Active-Token": ACTIVE_TOKEN, ...(spoof ? spoofed : {}),
                ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
              ...(method === "POST" ? { body: "{" } : {}) });
            expect(response.status).toBe(401);
            expect(await response.text()).toBe('{"error":"Unauthorized"}');
            expect(response.headers.get("location")).toBeNull();
            expect(response.headers.get("content-type")).toContain("application/json");
            for (const detail of [AUTH_TOKEN, BOOTSTRAP_TOKEN, ACTIVE_TOKEN, "127.0.0.1", ...Object.values(spoofed)]) {
              expect(JSON.stringify([...response.headers])).not.toContain(detail);
            }
          }
        }
      }
      for (const body of [JSON.stringify({ remoteAddress: "172.18.0.1", origin: "10.0.0.1" }),
        JSON.stringify({ prompt: "x".repeat(1_048_576) })]) {
        const response = await fetch(`${baseUrl}/session`, { method: "POST", body,
          headers: { "content-type": "application/json", authorization: `Bearer ${AUTH_TOKEN}` } });
        expect(response.status).toBe(401);
        expect(await response.text()).toBe('{"error":"Unauthorized"}');
      }
      for (const path of ["/health/live", "/health/ready"]) {
        for (const authorization of [undefined, "malformed", `Bearer ${AUTH_TOKEN}`]) {
          const response = await fetch(`${baseUrl}${path}`, {
            headers: { ...spoofed, ...(authorization === undefined ? {} : { authorization }) } });
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual(path.endsWith("live") ? { ok: true } : { ready: true });
        }
      }
      expect(authorize).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
      expect(auth.snapshot()).toEqual({ mode });
      for (const call of calls) expect(call).not.toHaveBeenCalled();
      expect(logged).toEqual([]);
      expect(JSON.stringify(currentServer)).toBe("{}");
      for (const detail of [AUTH_TOKEN, BOOTSTRAP_TOKEN, ACTIVE_TOKEN, "127.0.0.1", "172.18.0.1"]) {
        expect(inspect(currentServer, { showHidden: true })).not.toContain(detail);
      }
    } finally {
      factory.mockRestore();
      for (const log of logs) log.mockRestore();
    }
  });

  it("activates bootstrap auth with an empty 204 and immediately accepts only the active token", async () => {
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter(), host: "127.0.0.1", port,
      bootstrapToken: BOOTSTRAP_TOKEN, logger: quietLogger,
    });
    await currentServer.start();
    const baseUrl = `http://127.0.0.1:${port}`;
    const activation = await fetch(`${baseUrl}/control/activate`, {
      method: "POST", headers: {
        authorization: `Bearer ${BOOTSTRAP_TOKEN}`,
        "X-Almirant-Active-Token": ACTIVE_TOKEN,
        "content-type": "application/json",
      }, body: "{",
    });
    expect(activation.status).toBe(204);
    expect(await activation.text()).toBe("");
    expect(activation.headers.get("content-type")).toBeNull();
    for (const token of [ACTIVE_TOKEN, BOOTSTRAP_TOKEN, AUTH_TOKEN]) {
      const response = await fetch(`${baseUrl}/session`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(token === ACTIVE_TOKEN ? 200 : 401);
      expect(await response.text()).toBe(token === ACTIVE_TOKEN ? "[]" : '{"error":"Unauthorized"}');
    }
  });

  it("rejects malformed and duplicate activation headers without consuming bootstrap or leaking credentials", async () => {
    const port = await getFreePort();
    const logged: unknown[] = [];
    const logs = (["log", "info", "warn", "error", "debug", "trace"] as const)
      .map((method) => spyOn(console, method).mockImplementation((...args) => { logged.push(args); }));
    try {
      currentServer = createShimServer({
        adapter: createAdapter(), host: "127.0.0.1", port, bootstrapToken: BOOTSTRAP_TOKEN,
        logger: { info: (...args) => logged.push(args), error: (...args) => logged.push(args) },
      });
      await currentServer.start();
      const request = (headers: string[], path = "/control/activate", method = "POST") =>
        new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
          const req = httpRequest({ host: "127.0.0.1", port, path, method,
            headers: ["Host", "127.0.0.1", "Content-Type", "application/json", ...headers] }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => resolve({ status: res.statusCode, body }));
            res.on("error", reject);
          });
          req.on("error", reject);
          req.setTimeout(1_000, () => req.destroy(new Error("HTTP test timed out")));
          req.end(method === "POST" ? "{" : undefined);
        });
      const bearer = `Bearer ${BOOTSTRAP_TOKEN}`;
      const headers = (authorization?: string, proposed?: string) => [
        ...(authorization === undefined ? [] : ["aUtHoRiZaTiOn", authorization]),
        ...(proposed === undefined ? [] : ["X-Almirant-Active-Token", proposed]),
      ];
      const denied = { status: 401, body: '{"error":"Unauthorized"}' };
      const invalidBearers = [undefined, "", BOOTSTRAP_TOKEN, `Bearer ${AUTH_TOKEN}`,
        `Bearer ${ACTIVE_TOKEN}`, `bearer ${BOOTSTRAP_TOKEN}`, `BEARER ${BOOTSTRAP_TOKEN}`,
        `Bearer  ${BOOTSTRAP_TOKEN}`, `Bearer\t${BOOTSTRAP_TOKEN}`, `${bearer}=`,
        `${bearer}, ${bearer}`, `Bearer ${BOOTSTRAP_TOKEN.slice(0, -1)}x`];
      const invalidProposals = [undefined, "", "invalid", BOOTSTRAP_TOKEN, `${ACTIVE_TOKEN}=`,
        `Bearer ${ACTIVE_TOKEN}`, `${ACTIVE_TOKEN},${ACTIVE_TOKEN}`, `${ACTIVE_TOKEN.slice(0, -1)}1`,
        Buffer.alloc(31, 13).toString("base64url"), "+".repeat(43), "/".repeat(43)];
      for (const authorization of [bearer, ...invalidBearers]) {
        for (const proposed of [ACTIVE_TOKEN, ...invalidProposals]) {
          if (authorization === bearer && proposed === ACTIVE_TOKEN) continue;
          expect(await request(headers(authorization, proposed))).toEqual(denied);
        }
      }
      for (const name of ["Authorization", "X-Almirant-Active-Token"]) {
        const correct = name === "Authorization" ? bearer : ACTIVE_TOKEN;
        const other = name === "Authorization" ? ["X-Almirant-Active-Token", ACTIVE_TOKEN] : ["Authorization", bearer];
        for (const values of [[correct, "wrong"], ["wrong", correct], [correct, correct]]) {
          expect(await request([...other, name, values[0]!, name.toLowerCase(), values[1]!])).toEqual(denied);
        }
      }
      expect(await request(headers(`Bearer ${ACTIVE_TOKEN}`), "/session", "GET")).toEqual(denied);
      // Mixed-case field names are legal; their values must remain canonical.
      expect(await request(headers(bearer, ACTIVE_TOKEN))).toEqual({ status: 204, body: "" });
      for (const token of [BOOTSTRAP_TOKEN, ACTIVE_TOKEN, AUTH_TOKEN]) {
        for (const proposed of [ACTIVE_TOKEN, AUTH_TOKEN]) {
          expect(await request(headers(`Bearer ${token}`, proposed))).toEqual(denied);
        }
      }
      const activeBearer = `Bearer ${ACTIVE_TOKEN}`;
      for (const values of [[activeBearer, "wrong"], ["wrong", activeBearer], [activeBearer, activeBearer]]) {
        expect(await request(["Authorization", values[0]!, "authorization", values[1]!], "/session", "GET")).toEqual(denied);
      }
      for (const token of [BOOTSTRAP_TOKEN, AUTH_TOKEN]) {
        expect(await request(headers(`Bearer ${token}`), "/session", "GET")).toEqual(denied);
      }
      expect(await request(headers(activeBearer), "/session", "GET")).toEqual({ status: 200, body: "[]" });
      for (const token of [BOOTSTRAP_TOKEN, ACTIVE_TOKEN, AUTH_TOKEN]) {
        expect(JSON.stringify(logged)).not.toContain(token);
        expect(inspect(currentServer, { showHidden: true })).not.toContain(token);
      }
      expect(logged).toHaveLength(1); // Only the existing listener-start message.
    } finally { for (const log of logs) log.mockRestore(); }
  });

  it("commits activation before response completion so an active-token probe survives a lost response", async () => {
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter: createAdapter(), host: "127.0.0.1", port,
      bootstrapToken: BOOTSTRAP_TOKEN, logger: quietLogger,
    });
    await currentServer.start();
    const baseUrl = `http://127.0.0.1:${port}`;
    const ending = createDeferred();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let held: ServerResponse | undefined;
    const prototype = ServerResponse.prototype as unknown as {
      end: (this: ServerResponse, ...args: unknown[]) => ServerResponse;
    };
    const originalEnd = prototype.end;
    // Keep Express and real HTTP handling intact; withhold only the transport completion.
    prototype.end = function (...args) {
      if (this.req.url === "/control/activate" && this.statusCode === 204) {
        held = this;
        ending.resolve();
        return this;
      }
      return Reflect.apply(originalEnd, this, args);
    };
    const controller = new AbortController();
    const activation = fetch(`${baseUrl}/control/activate`, {
      method: "POST", signal: controller.signal,
      headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, "X-Almirant-Active-Token": ACTIVE_TOKEN },
    }).then(() => "received", () => "lost");
    try {
      await Promise.race([ending.promise, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Activation response did not reach end")), 1_000);
      })]);
      expect(held!.writableEnded).toBe(false);
      expect(held!.headersSent).toBe(false);
      const proof = await fetch(`${baseUrl}/session`, { headers: { authorization: `Bearer ${ACTIVE_TOKEN}` } });
      expect(proof.status).toBe(200);
      expect(await proof.text()).toBe("[]");
      const replay = await fetch(`${baseUrl}/control/activate`, {
        method: "POST", headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`, "X-Almirant-Active-Token": AUTH_TOKEN },
      });
      expect(replay.status).toBe(401);
      expect(await replay.text()).toBe('{"error":"Unauthorized"}');
      controller.abort();
      expect(await activation).toBe("lost");
    } finally {
      clearTimeout(timer);
      prototype.end = originalEnd;
      controller.abort();
      held?.destroy();
      await activation;
    }
  });

  it("rejects mutually exclusive tokens before adapter registration with a generic error", () => {
    const adapter = createAdapter();
    const listen = spyOn(adapter, "onEvent");
    for (const authToken of [AUTH_TOKEN, "", null]) {
      expect(() => createShimServer({ adapter, authToken: authToken as string,
        bootstrapToken: BOOTSTRAP_TOKEN, logger: quietLogger,
      })).toThrow("Invalid control authentication configuration");
    }
    expect(listen).not.toHaveBeenCalled();
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

  it.each(["static", "bootstrap", "active"] as const)("rejects invalid bearers on every control route before parsing bodies or calling adapters in %s mode", async (mode) => {
    const adapter = createAdapter({ async abortSession() { return true; } });
    const calls = (["createSession", "listSessions", "getSession", "deleteSession",
      "sendPrompt", "abortSession"] as const).map((method) => spyOn(adapter, method));
    const logged: unknown[] = [];
    const port = await getFreePort();
    currentServer = createShimServer({
      adapter, host: "127.0.0.1", port,
      ...(mode === "static" ? { authToken: AUTH_TOKEN } : { bootstrapToken: BOOTSTRAP_TOKEN }),
      logger: { info: (...args) => logged.push(args), error: (...args) => logged.push(args) },
    });
    await currentServer.start();
    if (mode === "active") {
      expect((await fetch(`http://127.0.0.1:${port}/control/activate`, {
        method: "POST", headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`,
          "X-Almirant-Active-Token": ACTIVE_TOKEN },
      })).status).toBe(204);
    }
    const otherToken = Buffer.alloc(32, 12).toString("base64url");
    // Protocol/route provenance: reference tree 32a7844e, without origin gating.
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
      `Bearer ${AUTH_TOKEN}, Bearer ${AUTH_TOKEN}`,
      ...(mode === "bootstrap" ? [`Bearer ${ACTIVE_TOKEN}`, `Bearer ${AUTH_TOKEN}`] : []),
      ...(mode === "active" ? [`Bearer ${AUTH_TOKEN}`, `bearer ${ACTIVE_TOKEN}`,
        `Bearer  ${ACTIVE_TOKEN}`, `Bearer\t${ACTIVE_TOKEN}`, `Bearer ${ACTIVE_TOKEN}=`,
        `Bearer ${ACTIVE_TOKEN}, Bearer ${ACTIVE_TOKEN}`] : [])]) {
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
    expect(JSON.stringify(logged)).not.toContain(ACTIVE_TOKEN);
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

  it.each((["disabled", "static", "active"] as const).flatMap((mode) =>
    [undefined, false].map((requireExternalControlOrigin) => [mode, requireExternalControlOrigin] as const)
  ))("preserves every route in %s mode with external-origin option %s", async (mode, requireExternalControlOrigin) => {
    const authToken = mode === "static" ? AUTH_TOKEN : mode === "active" ? ACTIVE_TOKEN : undefined;
    const port = await getFreePort();
    let listener: RuntimeEventListener = () => {};
    const adapter = createAdapter({
      onEvent(callback) { listener = callback; return () => {}; },
      async sendPrompt(sessionId) { listener({ type: "session.idle", properties: { sessionId } }); },
      async abortSession() { return true; },
    });
    const prompt = spyOn(adapter, "sendPrompt");
    currentServer = createShimServer({
      adapter, host: "127.0.0.1", port, logger: quietLogger, requireExternalControlOrigin,
      ...(mode === "active" ? { bootstrapToken: BOOTSTRAP_TOKEN } : { authToken }),
    });
    await currentServer.start();
    const baseUrl = `http://127.0.0.1:${port}`;
    if (mode === "active") {
      expect((await fetch(`${baseUrl}/control/activate`, {
        method: "POST", headers: { authorization: `Bearer ${BOOTSTRAP_TOKEN}`,
          "X-Almirant-Active-Token": ACTIVE_TOKEN },
      })).status).toBe(204);
    }
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
    expect((await request("/control/activate", "POST")).status).toBe(mode === "active" ? 401 : 404);
    if (mode !== "active") {
      for (const token of [BOOTSTRAP_TOKEN, ACTIVE_TOKEN, AUTH_TOKEN]) {
        const response = await fetch(`${baseUrl}/control/activate`, {
          method: "POST", headers: { authorization: `Bearer ${token}`,
            "X-Almirant-Active-Token": ACTIVE_TOKEN },
        });
        expect(response.status).toBe(mode === "disabled" || token === AUTH_TOKEN ? 404 : 401);
      }
      expect((await request("/session")).status).toBe(200);
    }
  });

  it.each((["authToken", "bootstrapToken"] as const).flatMap((option) =>
    [undefined, false, true].map((requireExternalControlOrigin) => [option, requireExternalControlOrigin] as const)
  ))("rejects invalid %s configuration without side effects or secrets with external-origin option %s", (option, requireExternalControlOrigin) => {
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
          adapter, [option]: authToken as string, requireExternalControlOrigin,
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
      expect(source).not.toMatch(/authToken|bootstrapToken|requireExternalControlOrigin/);
      // Exact existing argument shape also excludes indirect/spread configuration.
      expect(source.match(/createShimServer\(([\s\S]*?)\);/)?.[1]?.replace(/\s/g, ""))
        .toBe("{adapter,host,port,heartbeatIntervalMs:15_000,}");
    }
    const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.env|Bun\.env/);
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

  it.each(["disabled", "static", "external"] as const)("keeps health public and rejects non-health admission while draining in %s mode", async (mode) => {
    const closeStarted = createDeferred();
    const allowClose = createDeferred();
    const authToken = mode === "disabled" ? undefined : AUTH_TOKEN;
    let closeCalls = 0;
    let eventListenerStops = 0;
    let canonicalListenerStops = 0;
    let nativeListenerStops = 0;

    const port = await getFreePort();
    currentServer = createShimServer({
      authToken,
      requireExternalControlOrigin: mode === "external",
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
      expect(rejected.status).toBe(mode === "external" ? 401 : 503);
      if (mode === "external") expect(await rejected.json()).toEqual({ error: "Unauthorized" });
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
