import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  PiAdapter,
  PiAdapterError,
  buildPiCommand,
  type PiAdapterErrorCode,
  type PiAdapterOptions,
  type PiChildProcess,
  type PiTimerApi,
} from "./pi-adapter.js";

type RpcRecord = Record<string, unknown> & { type: string; id?: string };

class FakeScheduler implements PiTimerApi {
  private sequence = 0;
  public readonly timers: Array<{
    id: number;
    callback: () => void;
    ms: number;
    active: boolean;
  }> = [];

  setTimeout = (callback: () => void, ms: number): unknown => {
    const timer = { id: ++this.sequence, callback, ms, active: true };
    this.timers.push(timer);
    return timer.id;
  };

  clearTimeout = (handle: unknown): void => {
    const timer = this.timers.find((entry) => entry.id === handle);
    if (timer) timer.active = false;
  };

  runNext(ms?: number): void {
    const timer = this.timers.find((entry) => entry.active && (ms === undefined || entry.ms === ms));
    if (!timer) throw new Error(`No active timer${ms === undefined ? "" : ` for ${ms}ms`}`);
    timer.active = false;
    timer.callback();
  }
}

class FakeChild extends EventEmitter implements PiChildProcess {
  public readonly pid = 4321;
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public readonly stdout = new EventEmitter();
  public readonly stderr = { resume: () => undefined };
  public readonly writes: RpcRecord[] = [];
  public onWrite: (record: RpcRecord, callback: (error?: Error | null) => void) => void =
    (_record, callback) => callback(null);
  public readonly stdin = {
    write: (wire: Uint8Array, callback: (error?: Error | null) => void): boolean => {
      const record = JSON.parse(Buffer.from(wire).toString("utf8")) as RpcRecord;
      this.writes.push(record);
      this.onWrite(record, callback);
      return true;
    },
    destroy: () => undefined,
  };

  emitRecord(record: Record<string, unknown>, splitAt?: number): void {
    const wire = Buffer.from(`${JSON.stringify(record)}\n`);
    if (splitAt === undefined) {
      this.stdout.emit("data", wire);
      return;
    }
    this.stdout.emit("data", wire.subarray(0, splitAt));
    this.stdout.emit("data", wire.subarray(splitAt));
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
};

const observedState = (provider = "anthropic", model = "claude-opus-5", thinking = "high") => ({
  agentActive: false,
  model: { provider, id: model },
  thinkingLevel: thinking,
});

const respond = (child: FakeChild, request: RpcRecord, data: Record<string, unknown> = {}): void => {
  child.emitRecord({
    type: "response",
    id: request.id,
    command: request.type,
    success: true,
    data,
  }, 3);
};

const createHarness = (overrides: Partial<PiAdapterOptions> = {}) => {
  const child = new FakeChild();
  const scheduler = new FakeScheduler();
  const spawns: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> = [];
  const terminations: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const removedConfigDirs: string[] = [];
  let id = 0;

  child.onWrite = (request, callback) => {
    callback(null);
    queueMicrotask(() => {
      if (request.type === "get_state") respond(child, request, observedState());
      else if (request.type === "prompt") respond(child, request, { accepted: true });
      else if (request.type === "abort") respond(child, request, { acknowledged: true, terminal: false });
      else if (request.type === "get_session_stats") {
        respond(child, request, {
          tokens: { input: 12, output: 4, cacheRead: 0, cacheWrite: 0, total: 16 },
        });
      }
    });
  };

  const adapter = new PiAdapter({
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/home/opencode",
      TMPDIR: "/tmp",
      TMP: "/tmp",
      TEMP: "/tmp",
      HTTP_PROXY: "http://egress-proxy:3128",
      HTTPS_PROXY: "http://egress-proxy:3128",
      NO_PROXY: "127.0.0.1,localhost,::1",
      SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
      SSL_CERT_DIR: "/etc/ssl/certs",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/runner-proxy-ca.pem",
      WORKSPACE_REPO_PATH: "/workspace",
      PI_PROVIDER: "anthropic",
      PI_MODEL: "claude-opus-5",
      PI_THINKING_LEVEL: "high",
      ZAI_API_KEY: "zai-selected-key",
      REASONING_BUDGET: "must-not-be-forwarded",
      PROVIDER_SECRET: "must-not-be-forwarded",
      AWS_SECRET_ACCESS_KEY: "must-not-be-forwarded",
      GITHUB_TOKEN: "must-not-be-forwarded",
      __GIT_CLONE_TOKEN: "must-not-be-forwarded",
      MCP_CONFIG_JSON: "must-not-be-forwarded",
      NODE_OPTIONS: "--require=/hostile/preload.cjs",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      XDG_CONFIG_HOME: "/hostile/config-home",
    },
    createId: () => `id-${++id}`,
    timers: scheduler,
    makeConfigDir: async () => "/tmp/almirant-pi-session",
    removeConfigDir: async (path) => { removedConfigDirs.push(path); },
    spawnProcess: (command, args, options) => {
      spawns.push({ command, args, options });
      return child;
    },
    terminateProcessGroup: async (pid, signal) => {
      terminations.push({ pid, signal });
      if (signal === "SIGKILL") queueMicrotask(() => child.exit(null, "SIGKILL"));
    },
    probeProcessGroup: () =>
      child.exitCode === null && child.signalCode === null,
    ...overrides,
  });

  return { adapter, child, scheduler, spawns, terminations, removedConfigDirs };
};

const createSession = async (adapter: PiAdapter) =>
  adapter.createSession({ cwd: "/workspace", provider: "anthropic", model: "claude-opus-5" });

const invalidAuthFixtureRecords = async (): Promise<Record<string, unknown>[]> =>
  (await Bun.file(
    `${import.meta.dir}/../../../test/fixtures/pi-0.84.2/rpc-invalid-auth-v1.jsonl`,
  ).text())
    .trimEnd()
    .split("\n")
    .map((line) => (JSON.parse(line) as { record: Record<string, unknown> }).record);

describe("Pi typed runtime failure taxonomy", () => {
  it("maps adapter codes to safe typed metadata with explicit retryability", () => {
    const cases = [
      ["PI_RPC_AUTH_ERROR", "auth", false],
      ["PI_RPC_STATE_MISMATCH", "model", false],
      ["PI_RPC_ENDPOINT_ERROR", "endpoint", false],
      ["PI_RPC_PROTOCOL_ERROR", "protocol", false],
      ["PI_RPC_PROCESS_EXIT", "process", false],
      ["PI_RPC_TIMEOUT", "process", true],
      ["PI_RPC_CANCELLED", "cancellation", false],
      ["PI_RPC_USAGE_INTEGRITY_ERROR", "usage", false],
      ["PI_RPC_CONFIG_ERROR", "policy", false],
    ] as const satisfies readonly (
      readonly [PiAdapterErrorCode, string, boolean]
    )[];

    for (const [code, category, retryable] of cases) {
      const error = new PiAdapterError(
        code,
        "Bearer FAKE_PI_ADAPTER_SECRET_123456 at https://private.example.test",
      );
      expect(error).toMatchObject({
        code,
        category,
        retryable,
        runtimeFailure: {
          schemaVersion: "runtime-failure-v1",
          category,
          retryable,
          causeCode: code,
        },
      });
      expect(error.message.length).toBeLessThanOrEqual(160);
      expect(JSON.stringify(error)).not.toMatch(
        /FAKE_PI_ADAPTER_SECRET|private\.example\.test|Bearer/,
      );
    }
  });
});

describe("Pi private RPC authentication classification", () => {
  it("maps exact repeated 0.84.2 Z.AI diagnostics with duplicate 401 statuses to one safe nonretryable auth terminal and one cleanup", async () => {
    const harness = createHarness({
      env: {
        WORKSPACE_REPO_PATH: "/workspace",
        PI_PROVIDER: "zai",
        PI_MODEL: "glm-5.3",
        ZAI_API_KEY: "synthetic-test-key",
      },
    });
    harness.child.onWrite = (request, callback) => {
      callback(null);
      queueMicrotask(() => {
        if (request.type === "get_state") {
          respond(harness.child, request, observedState("zai", "glm-5.3", "high"));
        } else if (request.type === "prompt") {
          respond(harness.child, request, { accepted: true });
        }
      });
    };
    const legacy: Array<Record<string, unknown>> = [];
    const canonical: Array<Record<string, unknown>> = [];
    const native: Array<Record<string, unknown>> = [];
    harness.adapter.onEvent((event: unknown) => {
      legacy.push(event as Record<string, unknown>);
    });
    harness.adapter.onCanonicalEvent((event: unknown) => {
      canonical.push(event as Record<string, unknown>);
    });
    harness.adapter.onNativeEvent((event: unknown) => {
      native.push(event as Record<string, unknown>);
    });

    const session = await createSession(harness.adapter);
    await harness.adapter.sendPrompt(session.id, {
      parts: [{ type: "text", text: "probe with synthetic records only" }],
    });
    const invalidAuthRecords = await invalidAuthFixtureRecords();
    const privateMessages = invalidAuthRecords.flatMap((record) => {
      const direct = record.message as Record<string, unknown> | undefined;
      const messages = Array.isArray(record.messages)
        ? record.messages as Array<Record<string, unknown>>
        : [];
      return [
        ...(direct && Object.hasOwn(direct, "errorMessage") ? [direct] : []),
        ...messages.filter((message) => Object.hasOwn(message, "errorMessage")),
      ];
    });
    const privateDiagnostics = privateMessages
      .map((message) => message.errorMessage)
      .filter((diagnostic): diagnostic is string => typeof diagnostic === "string");
    expect(privateMessages).toHaveLength(4);
    expect(privateMessages.every((message) => message.stopReason === "error"))
      .toBe(true);
    expect(privateDiagnostics).toHaveLength(4);
    expect(privateDiagnostics.map((diagnostic) =>
      Buffer.byteLength(diagnostic, "utf8")
    )).toEqual([58, 58, 58, 58]);
    expect(privateDiagnostics.reduce((total, diagnostic) =>
      total + Buffer.byteLength(diagnostic, "utf8"), 0
    )).toBe(232);
    expect(new Set(privateDiagnostics).size).toBe(1);
    expect(privateDiagnostics.map((diagnostic) =>
      diagnostic.match(/(?<![A-Za-z0-9_])[0-9]{3}(?![A-Za-z0-9_])/gu)
    )).toEqual([
      ["401", "401"],
      ["401", "401"],
      ["401", "401"],
      ["401", "401"],
    ]);
    expect(invalidAuthRecords.filter((record) =>
      record.type === "auto_retry_start" || record.type === "auto_retry_end"
    )).toHaveLength(0);
    for (const record of invalidAuthRecords) harness.child.emitRecord(record);
    await flush();

    expect((await harness.adapter.getSession(session.id))?.status).toBe("error");
    expect(canonical.filter((event) => event.kind === "session.error"))
      .toEqual([expect.objectContaining({
        errorCode: "PI_RPC_AUTH_ERROR",
        errorCategory: "config",
        recoverable: false,
        runtimeFailure: {
          schemaVersion: "runtime-failure-v1",
          code: "RUNTIME_AUTH_FAILURE",
          category: "auth",
          retryable: false,
          message: "Runtime authentication failed.",
          causeCode: "PI_RPC_AUTH_ERROR",
        },
      })]);
    expect(canonical.filter((event) => event.kind === "session.idle")).toHaveLength(1);
    expect(legacy.filter((event) => event.type === "session.idle")).toHaveLength(1);
    expect(legacy.filter((event) =>
      event.type === "session.status" &&
      (event.properties as Record<string, unknown>)?.status === "error"
    )).toHaveLength(1);
    expect(harness.child.writes.filter((record) => record.type === "get_session_stats"))
      .toHaveLength(0);
    expect(harness.terminations).toEqual([
      { pid: harness.child.pid, signal: "SIGTERM" },
    ]);
    const serializedEvents = JSON.stringify({ legacy, canonical, native });
    expect(serializedEvents).not.toMatch(
      /errorMessage|FAKE_PI_PRIVATE|fingerprint|digest/,
    );
    for (const diagnostic of privateDiagnostics) {
      expect(serializedEvents).not.toContain(diagnostic);
    }

    harness.child.exit(null, "SIGTERM");
    await expect(harness.adapter.deleteSession(session.id)).resolves.toBe(true);
    expect(harness.removedConfigDirs).toEqual(["/tmp/almirant-pi-session"]);
    expect(harness.terminations).toHaveLength(1);
  });

  it("keeps mixed auth/non-auth and excessive status-token diagnostics generic without leaks or cleanup regressions", async () => {
    for (const privateDiagnostics of [
      ["HTTP 401 / HTTP 404"],
      ["HTTP 401 / HTTP 429"],
      ["401 401 401 401 401"],
    ]) {
      const harness = createHarness({
        env: {
          WORKSPACE_REPO_PATH: "/workspace",
          PI_PROVIDER: "zai",
          PI_MODEL: "glm-5.3",
          ZAI_API_KEY: "synthetic-test-key",
        },
      });
      harness.child.onWrite = (request, callback) => {
        callback(null);
        queueMicrotask(() => {
          if (request.type === "get_state") {
            respond(harness.child, request, observedState("zai", "glm-5.3", "high"));
          } else if (request.type === "prompt") {
            respond(harness.child, request, { accepted: true });
          } else if (request.type === "get_session_stats") {
            respond(harness.child, request, {
              tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            });
          }
        });
      };
      const legacy: Array<Record<string, unknown>> = [];
      const canonical: Array<Record<string, unknown>> = [];
      const native: Array<Record<string, unknown>> = [];
      harness.adapter.onEvent((event: unknown) => {
        legacy.push(event as Record<string, unknown>);
      });
      harness.adapter.onCanonicalEvent((event: unknown) => {
        canonical.push(event as Record<string, unknown>);
      });
      harness.adapter.onNativeEvent((event: unknown) => {
        native.push(event as Record<string, unknown>);
      });

      const session = await createSession(harness.adapter);
      await harness.adapter.sendPrompt(session.id, {
        parts: [{ type: "text", text: "probe conflicting statuses" }],
      });
      for (const errorMessage of privateDiagnostics) {
        harness.child.emitRecord({
          type: "message_end",
          message: { role: "assistant", stopReason: "error", errorMessage },
        });
      }
      harness.child.emitRecord({ type: "agent_settled" });
      await flush();

      const caseLabel = privateDiagnostics.join(" | ");
      expect((await harness.adapter.getSession(session.id))?.status, caseLabel)
        .toBe("idle");
      expect(canonical.filter((event) => event.kind === "session.error"), caseLabel)
        .toEqual([expect.objectContaining({
          errorCode: "PI_RPC_AGENT_ERROR",
          recoverable: false,
        })]);
      expect(canonical.some((event) => event.errorCode === "PI_RPC_AUTH_ERROR"), caseLabel)
        .toBe(false);
      expect(canonical.filter((event) => event.kind === "session.idle"), caseLabel)
        .toHaveLength(1);
      expect(harness.child.writes.filter((record) => record.type === "get_session_stats"), caseLabel)
        .toHaveLength(1);
      expect(harness.terminations, caseLabel).toHaveLength(0);
      const serializedEvents = JSON.stringify({ legacy, canonical, native });
      expect(serializedEvents, caseLabel).not.toMatch(
        /errorMessage|fingerprint|digest/,
      );
      for (const diagnostic of privateDiagnostics) {
        expect(serializedEvents, caseLabel).not.toContain(diagnostic);
      }

      const deleting = harness.adapter.deleteSession(session.id);
      await flush();
      expect(harness.terminations, caseLabel).toEqual([
        { pid: harness.child.pid, signal: "SIGTERM" },
      ]);
      harness.child.exit(null, "SIGTERM");
      await expect(deleting, caseLabel).resolves.toBe(true);
      expect(harness.removedConfigDirs, caseLabel)
        .toEqual(["/tmp/almirant-pi-session"]);
    }
  });
});

describe("Pi sterile command and startup", () => {
  it("pins the WU-1 sterile flags, built-in tool allowlist, and exact provider/model/thinking", async () => {
    const args = buildPiCommand({ provider: "anthropic", model: "claude-opus-5", thinking: "high" });
    expect(args).toEqual([
      "--mode", "rpc",
      "--no-session",
      "--offline",
      "--no-context-files",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-approve",
      "--tools", "read,bash,edit,write,grep,find,ls",
      "--provider", "anthropic",
      "--model", "claude-opus-5",
      "--thinking", "high",
    ]);
    expect(() => buildPiCommand({ provider: "", model: "claude-opus-5" })).toThrow("PI_RPC_CONFIG_ERROR");
    expect(() => buildPiCommand({ provider: "anthropic", model: "" })).toThrow("PI_RPC_CONFIG_ERROR");

    const { adapter, spawns } = createHarness();
    await createSession(adapter);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatchObject({ command: "pi" });
    expect(spawns[0]!.options).toMatchObject({ cwd: "/workspace", detached: true });
    expect(Object.keys(spawns[0]!.options.env as NodeJS.ProcessEnv).sort()).toEqual([
      "HOME",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NODE_EXTRA_CA_CERTS",
      "NO_PROXY",
      "PATH",
      "PI_CODING_AGENT_DIR",
      "PI_MODEL",
      "PI_OFFLINE",
      "PI_PROVIDER",
      "PI_SKIP_VERSION_CHECK",
      "PI_TELEMETRY",
      "PI_THINKING_LEVEL",
      "SSL_CERT_DIR",
      "SSL_CERT_FILE",
      "TEMP",
      "TMP",
      "TMPDIR",
      "WORKSPACE_REPO_PATH",
      "ZAI_API_KEY",
    ]);
    expect(spawns[0]!.options.env).toMatchObject({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/home/opencode",
      TMPDIR: "/tmp",
      TMP: "/tmp",
      TEMP: "/tmp",
      HTTP_PROXY: "http://egress-proxy:3128",
      HTTPS_PROXY: "http://egress-proxy:3128",
      NO_PROXY: "127.0.0.1,localhost,::1",
      SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
      SSL_CERT_DIR: "/etc/ssl/certs",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/runner-proxy-ca.pem",
      WORKSPACE_REPO_PATH: "/workspace",
      PI_PROVIDER: "anthropic",
      PI_MODEL: "claude-opus-5",
      PI_THINKING_LEVEL: "high",
      ZAI_API_KEY: "zai-selected-key",
      PI_CODING_AGENT_DIR: "/tmp/almirant-pi-session",
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
      PI_SKIP_VERSION_CHECK: "1",
    });
    expect(spawns[0]!.options.env).not.toHaveProperty("PROVIDER_SECRET");
    expect(spawns[0]!.options.env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(spawns[0]!.options.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(spawns[0]!.options.env).not.toHaveProperty("__GIT_CLONE_TOKEN");
    expect(spawns[0]!.options.env).not.toHaveProperty("MCP_CONFIG_JSON");
    expect(spawns[0]!.options.env).not.toHaveProperty("NODE_OPTIONS");
    expect(spawns[0]!.options.env).not.toHaveProperty("NODE_TLS_REJECT_UNAUTHORIZED");
    expect(spawns[0]!.options.env).not.toHaveProperty("XDG_CONFIG_HOME");
    expect(spawns[0]!.options.env).not.toHaveProperty("REASONING_BUDGET");
  });

  it("creates an empty-body session from the exact runner-owned Pi selection", async () => {
    const harness = createHarness({
      env: {
        PI_PROVIDER: "zai",
        PI_MODEL: "glm-5.3",
        PI_THINKING_LEVEL: "high",
        ZAI_API_KEY: "zai-test-key",
        WORKSPACE_REPO_PATH: "/runner/workspace/repo",
      },
    });
    harness.child.onWrite = (request, callback) => {
      callback(null);
      queueMicrotask(() =>
        respond(
          harness.child,
          request,
          observedState("zai", "glm-5.3", "high"),
        )
      );
    };

    const session = await harness.adapter.createSession({});

    expect(session).toMatchObject({
      cwd: "/runner/workspace/repo",
      provider: "zai",
      model: "glm-5.3",
    });
    expect(harness.spawns[0]?.options).toMatchObject({
      cwd: "/runner/workspace/repo",
    });
    expect(harness.spawns[0]?.args).toEqual(expect.arrayContaining([
      "--provider",
      "zai",
      "--model",
      "glm-5.3",
      "--thinking",
      "high",
    ]));
    expect(harness.spawns[0]?.options.env).toMatchObject({
      ZAI_API_KEY: "zai-test-key",
      PI_PROVIDER: "zai",
      PI_MODEL: "glm-5.3",
    });
  });

  it("does not let a session-create body override the runner-owned selection", async () => {
    const harness = createHarness({
      env: {
        PI_PROVIDER: "zai",
        PI_MODEL: "glm-5.3",
        WORKSPACE_REPO_PATH: "/runner/workspace/repo",
      },
    });
    harness.child.onWrite = (request, callback) => {
      callback(null);
      queueMicrotask(() =>
        respond(harness.child, request, observedState("zai", "glm-5.3", "high"))
      );
    };

    const session = await harness.adapter.createSession({
      cwd: "/request/controlled-workspace",
      provider: "openai",
      model: "gpt-hostile",
    });

    expect(session).toMatchObject({
      cwd: "/runner/workspace/repo",
      provider: "zai",
      model: "glm-5.3",
    });
    expect(harness.spawns[0]?.options).toMatchObject({
      cwd: "/runner/workspace/repo",
    });
    expect(harness.spawns[0]?.args).not.toContain("gpt-hostile");
  });

  it("requires exact observed provider/model/thinking and never rewrites requested values", async () => {
    const harness = createHarness();
    harness.child.onWrite = (request, callback) => {
      callback(null);
      queueMicrotask(() => respond(harness.child, request, observedState("anthropic", "rewritten-model", "high")));
    };
    const creating = createSession(harness.adapter);
    await flush();
    harness.scheduler.runNext(2_000);
    await flush();
    await expect(creating).rejects.toThrow("PI_RPC_STATE_MISMATCH");
    expect(harness.child.writes[0]).toMatchObject({ type: "get_state" });
  });
});

describe("Pi response and terminal state machine", () => {
  it("finalizes once after duplicate settlement, makes post-turn stats authoritative, and preserves final usage detail", async () => {
    const { adapter, child } = createHarness();
    const legacy: Array<{ type: string; properties: Record<string, unknown> }> = [];
    const canonical: Array<Record<string, unknown>> = [];
    adapter.onEvent((event: unknown) => legacy.push(event as typeof legacy[number]));
    adapter.onCanonicalEvent((event: unknown) => canonical.push(event as Record<string, unknown>));
    const session = await createSession(adapter);
    await adapter.sendPrompt(session.id, { parts: [{ type: "text", text: "inspect" }] });

    child.emitRecord({
      type: "message_end",
      message: {
        role: "assistant",
        usage: {
          input: 10,
          output: 3,
          reasoning: 2,
          cacheRead: 1,
          cacheWrite: 0,
          totalTokens: 13,
          cost: { input: 0.01, output: 0.04, total: 0.05 },
        },
      },
    });
    child.emitRecord({ type: "agent_end" });
    expect(legacy.filter((event) => event.type === "session.idle")).toHaveLength(0);

    child.emitRecord({ type: "agent_settled" });
    child.emitRecord({ type: "agent_settled" });
    await flush();

    expect(child.writes.filter((record) => record.type === "get_session_stats")).toHaveLength(1);
    expect(legacy.filter((event) => event.type === "session.idle")).toHaveLength(1);
    expect(canonical.filter((event) => event.kind === "session.idle")).toHaveLength(1);
    expect(canonical.find((event) => event.kind === "session.idle")).toMatchObject({
      metadata: {
        usageSummary: {
          inputTokens: 12,
          outputTokens: 4,
          reasoningTokens: 2,
          totalTokens: 16,
          totalCostUsd: 0.05,
        },
      },
    });
    expect((await adapter.getSession(session.id))?.status).toBe("idle");
  });

  it("falls back to final-message usage when successful session stats are empty", async () => {
    const { adapter, child } = createHarness();
    const canonical: Array<Record<string, unknown>> = [];
    adapter.onCanonicalEvent((event: unknown) => canonical.push(event as Record<string, unknown>));
    const session = await createSession(adapter);

    child.onWrite = (request, callback) => {
      callback(null);
      queueMicrotask(() => {
        if (request.type === "prompt") respond(child, request, { accepted: true });
        else if (request.type === "get_session_stats") respond(child, request, { tokens: {} });
      });
    };
    await adapter.sendPrompt(session.id, { parts: [{ type: "text", text: "inspect" }] });
    const finalMessageEvent = {
      type: "message_end",
      message: {
        role: "assistant",
        timestamp: 1000,
        usage: {
          input: 5,
          output: 4,
          reasoning: 1,
          cacheRead: 2,
          cacheWrite: 1,
          totalTokens: 10,
          cost: { input: 0.25, output: 0.5, total: 0.75 },
        },
      },
    };
    child.emitRecord(finalMessageEvent);
    child.emitRecord(finalMessageEvent);
    child.emitRecord({ type: "agent_settled" });
    await flush();

    expect(child.writes.filter((record) => record.type === "get_session_stats")).toHaveLength(1);
    expect(canonical.filter((event) => event.kind === "session.idle")).toHaveLength(1);
    expect(canonical.find((event) => event.kind === "session.idle")).toMatchObject({
      metadata: {
        usageSummary: {
          inputTokens: 5,
          outputTokens: 4,
          reasoningTokens: 1,
          cacheReadTokens: 2,
          cacheCreationTokens: 1,
          totalTokens: 10,
          totalCostUsd: 0.75,
          costDetail: { input: 0.25, output: 0.5, total: 0.75 },
        },
      },
    });
  });

  it("classifies partial or invalid usage as integrity failure while empty usage remains unavailable", async () => {
    const harness = createHarness();
    const canonical: Array<Record<string, unknown>> = [];
    harness.adapter.onCanonicalEvent((event: unknown) => {
      canonical.push(event as Record<string, unknown>);
    });
    const session = await createSession(harness.adapter);
    harness.child.onWrite = (request, callback) => {
      callback(null);
      queueMicrotask(() => {
        if (request.type === "prompt") {
          respond(harness.child, request, { accepted: true });
        } else if (request.type === "get_session_stats") {
          respond(harness.child, request, {
            tokens: {
              input: 12,
              output: "Bearer FAKE_USAGE_SECRET_123456",
            },
          });
        }
      });
    };

    await harness.adapter.sendPrompt(session.id, {
      parts: [{ type: "text", text: "inspect malformed usage" }],
    });
    harness.child.emitRecord({ type: "agent_settled" });
    await flush();

    expect((await harness.adapter.getSession(session.id))?.status).toBe("error");
    expect(canonical).toContainEqual(expect.objectContaining({
      kind: "session.error",
      errorCode: "PI_RPC_USAGE_INTEGRITY_ERROR",
      recoverable: false,
      runtimeFailure: {
        schemaVersion: "runtime-failure-v1",
        code: "RUNTIME_USAGE_INTEGRITY_FAILURE",
        category: "usage",
        retryable: false,
        message: "Runtime usage integrity validation failed.",
        causeCode: "PI_RPC_USAGE_INTEGRITY_ERROR",
      },
    }));
    expect(JSON.stringify(canonical)).not.toMatch(/FAKE_USAGE_SECRET|Bearer/);
  });

  it("poisons unknown, duplicate, and malformed responses", async () => {
    for (const badResponse of [
      { type: "response", id: "unknown", command: "prompt", success: true },
      { type: "response", command: "prompt", success: true },
      { type: "response", id: "unknown", command: 7, success: true },
    ]) {
      const { adapter, child } = createHarness();
      const legacy: Array<{ type: string }> = [];
      adapter.onEvent((event: unknown) => legacy.push(event as { type: string }));
      const session = await createSession(adapter);
      child.emitRecord(badResponse);
      await flush();
      expect((await adapter.getSession(session.id))?.status).toBe("error");
      expect(legacy.filter((event) => event.type === "session.idle")).toHaveLength(1);
    }

    const { adapter, child } = createHarness();
    const session = await createSession(adapter);
    await adapter.sendPrompt(session.id, { parts: [{ type: "text", text: "once" }] });
    const prompt = child.writes.find((record) => record.type === "prompt")!;
    respond(child, prompt, { accepted: true });
    await flush();
    expect((await adapter.getSession(session.id))?.status).toBe("error");
  });

  it("poisons callback EPIPE and request timeout as typed terminal failures", async () => {
    const epipeHarness = createHarness();
    const epipeSession = await createSession(epipeHarness.adapter);
    epipeHarness.child.onWrite = (_request, callback) => callback(Object.assign(new Error("pipe closed"), { code: "EPIPE" }));
    await expect(epipeHarness.adapter.sendPrompt(epipeSession.id, {
      parts: [{ type: "text", text: "fail" }],
    })).rejects.toThrow("PI_RPC_STDIN_ERROR");
    expect((await epipeHarness.adapter.getSession(epipeSession.id))?.status).toBe("error");

    const timeoutHarness = createHarness({ requestTimeoutMs: 25 });
    const timeoutSession = await createSession(timeoutHarness.adapter);
    timeoutHarness.child.onWrite = (_request, callback) => callback(null);
    const pending = timeoutHarness.adapter.sendPrompt(timeoutSession.id, {
      parts: [{ type: "text", text: "timeout" }],
    });
    await flush();
    timeoutHarness.scheduler.runNext(25);
    await expect(pending).rejects.toThrow("PI_RPC_TIMEOUT");
    expect((await timeoutHarness.adapter.getSession(timeoutSession.id))?.status).toBe("error");
  });

  it("ignores a late EPIPE after the matching response already settled", async () => {
    const { adapter, child } = createHarness();
    const session = await createSession(adapter);
    child.onWrite = (request, callback) => {
      if (request.type === "prompt") {
        respond(child, request, { accepted: true });
        callback(Object.assign(new Error("late pipe close"), { code: "EPIPE" }));
      } else {
        callback(null);
        if (request.type === "get_session_stats") {
          queueMicrotask(() => respond(child, request, {
            tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
          }));
        }
      }
    };

    await expect(adapter.sendPrompt(session.id, {
      parts: [{ type: "text", text: "race" }],
    })).resolves.toBeUndefined();
    expect((await adapter.getSession(session.id))?.status).toBe("running");

    child.emitRecord({ type: "agent_settled" });
    await flush();
    expect((await adapter.getSession(session.id))?.status).toBe("idle");
  });

  it("allows valid auto-retries but poisons and cleans up a per-turn retry storm", async () => {
    const harness = createHarness({
      maxAutoRetryAttemptsPerTurn: 2,
      maxAutoRetryAttemptsPerSession: 8,
    });
    const canonical: Array<Record<string, unknown>> = [];
    harness.adapter.onCanonicalEvent((event: unknown) => {
      canonical.push(event as Record<string, unknown>);
    });
    const session = await createSession(harness.adapter);
    await harness.adapter.sendPrompt(session.id, {
      parts: [{ type: "text", text: "retry safely" }],
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      harness.child.emitRecord({ type: "auto_retry_start", attempt });
      harness.child.emitRecord({ type: "auto_retry_end", success: true, attempt });
    }
    expect((await harness.adapter.getSession(session.id))?.status).toBe("running");

    harness.child.emitRecord({ type: "auto_retry_start", attempt: 3 });
    await flush();
    expect((await harness.adapter.getSession(session.id))?.status).toBe("error");
    expect(canonical.filter((event) => event.kind === "session.idle")).toHaveLength(1);
    expect(canonical).toContainEqual(expect.objectContaining({
      kind: "session.error",
      errorCode: "PI_RPC_PROTOCOL_ERROR",
    }));
    expect(harness.terminations).toContainEqual({
      pid: harness.child.pid,
      signal: "SIGTERM",
    });

    harness.child.exit(null, "SIGTERM");
    await expect(harness.adapter.deleteSession(session.id)).resolves.toBe(true);
    expect(harness.removedConfigDirs).toEqual(["/tmp/almirant-pi-session"]);
  });

  it("caps cumulative auto-retry attempts across turns in one session", async () => {
    const harness = createHarness({
      maxAutoRetryAttemptsPerTurn: 2,
      maxAutoRetryAttemptsPerSession: 2,
    });
    const canonical: Array<Record<string, unknown>> = [];
    harness.adapter.onCanonicalEvent((event: unknown) => {
      canonical.push(event as Record<string, unknown>);
    });
    const session = await createSession(harness.adapter);

    for (const text of ["turn one", "turn two"]) {
      await harness.adapter.sendPrompt(session.id, {
        parts: [{ type: "text", text }],
      });
      harness.child.emitRecord({ type: "auto_retry_start" });
      harness.child.emitRecord({ type: "auto_retry_end", success: true });
      harness.child.emitRecord({ type: "agent_settled" });
      await flush();
      expect((await harness.adapter.getSession(session.id))?.status).toBe("idle");
    }

    await harness.adapter.sendPrompt(session.id, {
      parts: [{ type: "text", text: "turn three" }],
    });
    harness.child.emitRecord({ type: "auto_retry_end", success: true });
    await flush();

    expect((await harness.adapter.getSession(session.id))?.status).toBe("error");
    expect(canonical.filter((event) => event.kind === "session.idle")).toHaveLength(3);
    expect(canonical.filter((event) =>
      event.kind === "session.error" && event.errorCode === "PI_RPC_PROTOCOL_ERROR"
    )).toHaveLength(1);
    harness.child.exit(null, "SIGTERM");
    await expect(harness.adapter.deleteSession(session.id)).resolves.toBe(true);
  });

  it("treats code 0, nonzero, and signal exits before settlement as abnormal", async () => {
    for (const [code, signal, expected] of [
      [0, null, "PI_RPC_PROCESS_EXIT"],
      [9, null, "PI_RPC_PROCESS_EXIT"],
      [null, "SIGTERM", "PI_RPC_PROCESS_SIGNAL"],
    ] as const) {
      const harness = createHarness();
      harness.child.onWrite = (_request, callback) => callback(null);
      const creating = createSession(harness.adapter);
      await flush();
      harness.child.exit(code, signal);
      await expect(creating).rejects.toThrow(expected);
    }
  });

  it("poisons stdout EOF and unterminated partial output without settlement", async () => {
    for (const partial of [false, true]) {
      const { adapter, child } = createHarness();
      const session = await createSession(adapter);
      await adapter.sendPrompt(session.id, { parts: [{ type: "text", text: "stream" }] });
      if (partial) child.stdout.emit("data", Buffer.from('{"type":"text_update"'));
      child.stdout.emit("end");
      await flush();
      expect((await adapter.getSession(session.id))?.status).toBe("error");
    }
  });
});

describe("Pi abort, native diagnostics, and process cleanup", () => {
  it("does not treat abort acknowledgement as terminal and waits for settlement during an active tool", async () => {
    const { adapter, child, terminations } = createHarness();
    const canonical: Array<Record<string, unknown>> = [];
    adapter.onCanonicalEvent((event: unknown) => canonical.push(event as Record<string, unknown>));
    const session = await createSession(adapter);
    await adapter.sendPrompt(session.id, { parts: [{ type: "text", text: "run" }] });
    child.emitRecord({
      type: "tool_start",
      toolCallId: "call-active",
      toolName: "bash",
      arguments: { command: "sleep 100" },
    });

    let abortResolved = false;
    const aborting = adapter.abortSession(session.id).then((value) => {
      abortResolved = true;
      return value;
    });
    await flush();
    expect(abortResolved).toBe(false);
    expect(child.writes.filter((record) => record.type === "abort")).toHaveLength(1);

    child.emitRecord({ type: "agent_settled" });
    await flush();
    expect(abortResolved).toBe(false);
    expect(terminations).toContainEqual({ pid: child.pid, signal: "SIGTERM" });
    child.exit(null, "SIGTERM");
    expect(await aborting).toBe(true);
    expect(await adapter.getSession(session.id)).toBeNull();
    expect(canonical).toContainEqual(expect.objectContaining({
      kind: "agent.tool_call.result",
      toolName: "Bash",
      success: false,
      outputPreview: "interrupted",
    }));
    expect(canonical.find((event) =>
      event.kind === "agent.tool_call.result"
    )?.toolCallId).not.toBe("call-active");
  });

  it("emits observed AI provider/model without colliding with infrastructure provider", async () => {
    const harness = createHarness({
      env: {
        PI_PROVIDER: "zai",
        PI_MODEL: "glm-5.3",
        PI_THINKING_LEVEL: "high",
        WORKSPACE_REPO_PATH: "/workspace",
      },
    });
    harness.child.onWrite = (request, callback) => {
      callback(null);
      queueMicrotask(() => {
        if (request.type === "get_state") {
          respond(harness.child, request, observedState("zai", "glm-5.3", "high"));
        } else if (request.type === "prompt") {
          respond(harness.child, request, { accepted: true });
        } else if (request.type === "get_session_stats") {
          respond(harness.child, request, {
            tokens: {
              input: 5,
              output: 4,
              cacheRead: 2,
              cacheWrite: 1,
              total: 10,
            },
          });
        }
      });
    };
    const native: Array<Record<string, unknown>> = [];
    const canonical: Array<Record<string, unknown>> = [];
    harness.adapter.onNativeEvent((event: unknown) => {
      native.push(event as Record<string, unknown>);
    });
    harness.adapter.onCanonicalEvent((event: unknown) => {
      canonical.push(event as Record<string, unknown>);
    });
    const session = await createSession(harness.adapter);
    await harness.adapter.sendPrompt(session.id, {
      parts: [{ type: "text", text: "native selection" }],
    });

    harness.child.emitRecord({
      type: "tool_start",
      toolCallId: "call-selection",
      toolName: "read",
      arguments: { path: "README.md" },
    });

    expect(native).toHaveLength(1);
    expect(native[0]?.provider).toBeUndefined();
    expect(native[0]).toMatchObject({
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
    });

    harness.child.emitRecord({
      type: "message_end",
      message: {
        id: "message-selection",
        role: "assistant",
        stopReason: "stop",
        usage: {
          input: 5,
          output: 4,
          reasoning: 1,
          cacheRead: 2,
          cacheWrite: 1,
          totalTokens: 10,
          cost: { total: 0.75 },
        },
      },
    });
    harness.child.emitRecord({ type: "agent_settled" });
    await flush();

    const idle = canonical.find((event) => event.kind === "session.idle");
    expect((idle?.metadata as Record<string, unknown>).runtimeEvidence).toEqual({
      schemaVersion: "runtime-evidence-v1",
      usage: {
        status: "reported",
        source: "terminal_aggregate",
        identities: [{ messageId: expect.stringMatching(/^rti_sha256_[a-f0-9]{64}$/) }],
        inputTokens: 5,
        outputTokens: 4,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        reasoningTokens: 1,
        totalTokens: 10,
        cost: { totalUsd: 0.75, detail: { total: 0.75 } },
      },
      observed: {
        codingAgent: "pi",
        aiProvider: "zai",
        model: "glm-5.3",
        reasoningLevel: "high",
      },
    });
  });

  it("emits only allowlisted bounded native projections", async () => {
    const { adapter, child } = createHarness();
    const native: Array<Record<string, unknown>> = [];
    adapter.onNativeEvent((event: unknown) => native.push(event as Record<string, unknown>));
    const session = await createSession(adapter);
    await adapter.sendPrompt(session.id, { parts: [{ type: "text", text: "native" }] });
    child.emitRecord({
      type: "tool_start",
      toolCallId: "call-1",
      toolName: "read",
      arguments: { path: "https://secret.test", token: "sk-secret" },
      headers: { authorization: "Bearer secret" },
    });
    expect(native).toHaveLength(1);
    expect(JSON.stringify(native[0])).not.toMatch(/arguments|headers|secret\.test|sk-secret|Bearer secret/);
  });

  it("deletes with process-group TERM/KILL escalation, confirmed reap, and sterile config removal", async () => {
    const { adapter, child, scheduler, terminations, removedConfigDirs } = createHarness({
      terminateGraceMs: 50,
      reapTimeoutMs: 75,
    });
    const session = await createSession(adapter);
    const deleting = adapter.deleteSession(session.id);
    await flush();
    expect(terminations).toEqual([{ pid: child.pid, signal: "SIGTERM" }]);
    expect(removedConfigDirs).toHaveLength(0);

    scheduler.runNext(50);
    await flush();
    expect(terminations).toEqual([
      { pid: child.pid, signal: "SIGTERM" },
      { pid: child.pid, signal: "SIGKILL" },
    ]);
    expect(await deleting).toBe(true);
    expect(removedConfigDirs).toEqual(["/tmp/almirant-pi-session"]);
    expect(await adapter.getSession(session.id)).toBeNull();
  });

  it("fails typed cleanup when the direct child exits but its process group survives", async () => {
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const harness = createHarness({
      terminateGraceMs: 50,
      reapTimeoutMs: 75,
      processGroupPollIntervalMs: 10,
      terminateProcessGroup: async (pid, signal) => {
        signals.push({ pid, signal });
      },
      probeProcessGroup: () => true,
    });
    const session = await createSession(harness.adapter);

    harness.child.exit(0, null);
    const deleting = harness.adapter.deleteSession(session.id);
    await flush();
    expect(signals).toEqual([{ pid: harness.child.pid, signal: "SIGTERM" }]);

    harness.scheduler.runNext(50);
    await flush();
    expect(signals).toEqual([
      { pid: harness.child.pid, signal: "SIGTERM" },
      { pid: harness.child.pid, signal: "SIGKILL" },
    ]);

    harness.scheduler.runNext(75);
    const error = await deleting.catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "PI_PROCESS_GROUP_NOT_REAPED" });
    expect(String(error)).not.toMatch(/\/workspace|claude-opus-5/);
    expect(harness.removedConfigDirs).toEqual(["/tmp/almirant-pi-session"]);
  });

  it("close clears every session and waits for process-group cleanup", async () => {
    const harness = createHarness();
    const session = await createSession(harness.adapter);
    harness.terminations.length = 0;
    harness.child.exit = (code, signal) => {
      FakeChild.prototype.exit.call(harness.child, code, signal);
    };
    const closing = harness.adapter.close();
    await flush();
    expect(harness.terminations[0]).toEqual({ pid: harness.child.pid, signal: "SIGTERM" });
    harness.child.exit(null, "SIGTERM");
    await closing;
    expect(await harness.adapter.getSession(session.id)).toBeNull();
  });
});
