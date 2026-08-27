import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShimServer } from "@almirant/shim-server";
import {
  PiAdapter,
  type PiAdapterErrorCode,
  type PiAdapterOptions,
  type PiChildProcess,
  type PiRuntimeFailureCategory,
  type PiSpawnProcess,
} from "./pi-adapter.js";

const RAW_FAKE_SENTINEL = "RAW_FAKE_PI_WU11_SENTINEL_7f3d9a";
const PROCESS_DEADLINE_MS = 2_000;
const CLEANUP_DEADLINE_MS = 2_000;

type FakePiMode =
  | "active"
  | "malformed-json"
  | "null-record"
  | "primitive-record"
  | "oversized-record"
  | "partial-eof"
  | "epipe-write-close-race"
  | "clean-early-exit"
  | "nonzero-exit"
  | "signal-exit"
  | "request-timeout-hang"
  | "duplicate-settlement"
  | "success";

const FAKE_PI_PROGRAM = String.raw`
const { spawn } = require("node:child_process");
const { closeSync } = require("node:fs");
const mode = process.argv[1] || "active";
const sentinel = "RAW_FAKE_PI_WU11_SENTINEL_7f3d9a";
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: false,
  env: {},
  stdio: "ignore",
});
process.stderr.write("DIAGNOSTIC:" + sentinel + "\n");
process.stderr.write("TREE:" + descendant.pid + "\n");
let input = "";
const send = (record, callback) =>
  process.stdout.write(JSON.stringify(record) + "\n", callback);
const sendState = (request) => {
  send({
    type: "response",
    id: request.id,
    command: request.type,
    success: true,
    data: {
      agentActive: false,
      model: { provider: "sterile-provider", id: "sterile-model" },
      thinkingLevel: "high",
    },
  }, mode === "epipe-write-close-race"
    ? () => {
        process.stdin.pause();
        try { closeSync(0); } catch {}
        process.stderr.write("STDIN_CLOSED\n");
      }
    : undefined);
};
const sendStats = (request) => send({
  type: "response",
  id: request.id,
  command: request.type,
  success: true,
  data: {
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
  },
});
const failPrompt = () => {
  if (mode === "malformed-json") {
    process.stdout.write("{" + sentinel + "\n");
  } else if (mode === "null-record") {
    process.stdout.write("null\n");
  } else if (mode === "primitive-record") {
    process.stdout.write(JSON.stringify(sentinel) + "\n");
  } else if (mode === "oversized-record") {
    process.stdout.write(JSON.stringify({
      type: "oversized",
      payload: sentinel + "x".repeat(4_194_304),
    }) + "\n");
  } else if (mode === "partial-eof") {
    process.stdout.write(
      '{"type":"text_update","delta":"' + sentinel,
      () => process.exit(0),
    );
  } else if (mode === "clean-early-exit") {
    process.exit(0);
  } else if (mode === "nonzero-exit") {
    process.exit(23);
  } else if (mode === "signal-exit") {
    process.kill(process.pid, "SIGTERM");
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const newline = input.indexOf("\n");
    if (newline < 0) break;
    const line = input.slice(0, newline);
    input = input.slice(newline + 1);
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.type === "get_state") {
      sendState(request);
    } else if (request.type === "prompt") {
      process.stderr.write("PROMPT\n");
      if (
        mode === "malformed-json" ||
        mode === "null-record" ||
        mode === "primitive-record" ||
        mode === "oversized-record" ||
        mode === "partial-eof" ||
        mode === "clean-early-exit" ||
        mode === "nonzero-exit" ||
        mode === "signal-exit"
      ) {
        failPrompt();
      } else if (mode !== "request-timeout-hang") {
        if (mode === "active") {
          send({
            type: "tool_start",
            toolCallId: "sterile-active-tool",
            toolName: "bash",
            arguments: { command: "sterile-long-running-tool" },
          });
        }
        send({
          type: "response",
          id: request.id,
          command: request.type,
          success: true,
          data: { accepted: true },
        });
        if (mode === "success" || mode === "duplicate-settlement") {
          send({ type: "agent_settled" });
          if (mode === "duplicate-settlement") send({ type: "agent_settled" });
        }
      }
    } else if (request.type === "abort") {
      send({
        type: "response",
        id: request.id,
        command: request.type,
        success: true,
        data: { acknowledged: true },
      });
      send({ type: "agent_settled" });
    } else if (request.type === "get_session_stats") {
      sendStats(request);
    }
  }
});
setInterval(() => {}, 1000);
`;

type Signal = {
  promise: Promise<void>;
  resolve: () => void;
};

const signal = (): Signal => {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve,
  };
};

type RealHarness = {
  adapter: PiAdapter;
  configDirs: string[];
  directExited: Promise<void>;
  getPgid: () => number;
  getPromptCount: () => number;
  promptReady: Promise<void>;
  removedConfigDirs: string[];
  stdinClosed: Promise<void>;
  treeReady: Promise<void>;
};

const withinDeadline = async <T>(
  promise: Promise<T>,
  safeDescription: string,
  timeoutMs = PROCESS_DEADLINE_MS,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${safeDescription}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const getFreePort = async (): Promise<number> => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate process-test port");
  }
  return address.port;
};

const createRealHarness = (
  mode: FakePiMode = "active",
  overrides: Partial<PiAdapterOptions> = {},
): RealHarness => {
  let pgid = 0;
  let promptCount = 0;
  const configDirs: string[] = [];
  const removedConfigDirs: string[] = [];
  const treeReady = signal();
  const promptReady = signal();
  const stdinClosed = signal();
  const directExited = signal();

  const spawnProcess: PiSpawnProcess = (_command, _args, options) => {
    const child = spawn(process.execPath, ["-e", FAKE_PI_PROGRAM, mode], {
      cwd: options.cwd,
      detached: options.detached,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    pgid = child.pid ?? 0;
    child.once("exit", () => directExited.resolve());
    let diagnostics = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      diagnostics += chunk;
      for (;;) {
        const newline = diagnostics.indexOf("\n");
        if (newline < 0) break;
        const marker = diagnostics.slice(0, newline);
        diagnostics = diagnostics.slice(newline + 1);
        if (/^TREE:[1-9][0-9]*$/.test(marker)) treeReady.resolve();
        if (marker === "PROMPT") {
          promptCount += 1;
          promptReady.resolve();
        }
        if (marker === "STDIN_CLOSED") stdinClosed.resolve();
      }
    });
    return child as unknown as PiChildProcess;
  };

  const adapter = new PiAdapter({
    command: "sterile-pi-test-double",
    env: {
      WORKSPACE_REPO_PATH: process.cwd(),
      PI_PROVIDER: "sterile-provider",
      PI_MODEL: "sterile-model",
      PI_THINKING_LEVEL: "high",
    },
    spawnProcess,
    makeConfigDir: async () => {
      const path = await mkdtemp(join(tmpdir(), "almirant-pi-wu11-"));
      configDirs.push(path);
      return path;
    },
    removeConfigDir: async (path) => {
      removedConfigDirs.push(path);
      await rm(path, { recursive: true, force: true });
    },
    startupTimeoutMs: 500,
    requestTimeoutMs: 200,
    abortSettlementTimeoutMs: 500,
    terminateGraceMs: 100,
    reapTimeoutMs: 1_500,
    processGroupPollIntervalMs: 10,
    ...overrides,
  });

  return {
    adapter,
    configDirs,
    directExited: directExited.promise,
    getPgid: () => pgid,
    getPromptCount: () => promptCount,
    promptReady: promptReady.promise,
    removedConfigDirs,
    stdinClosed: stdinClosed.promise,
    treeReady: treeReady.promise,
  };
};

const processProbeError = (pid: number): unknown => {
  try {
    process.kill(pid, 0);
    return undefined;
  } catch (error) {
    return error;
  }
};

const expectDirectProcessGone = (pid: number): void => {
  expect(processProbeError(pid)).toMatchObject({ code: "ESRCH" });
};

const expectProcessGroupGone = (pgid: number): void => {
  expect(processProbeError(-pgid)).toMatchObject({ code: "ESRCH" });
};

const expectPathMissing = async (path: string): Promise<void> => {
  const observed = await stat(path).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(observed).toMatchObject({ code: "ENOENT" });
};

const expectSterileConfig = async (harness: RealHarness): Promise<string> => {
  expect(harness.configDirs).toHaveLength(1);
  const configDir = harness.configDirs[0]!;
  expect(await readdir(configDir)).toEqual([]);
  return configDir;
};

const expectCleanupEvidence = async (
  harness: RealHarness,
  configDir: string,
): Promise<void> => {
  const pgid = harness.getPgid();
  await withinDeadline(
    harness.directExited,
    "direct fake Pi process exit",
    CLEANUP_DEADLINE_MS,
  );
  expectDirectProcessGone(pgid);
  expectProcessGroupGone(pgid);
  expect(harness.removedConfigDirs).toEqual([configDir]);
  await expectPathMissing(configDir);
};

const forceCleanup = async (harness: RealHarness): Promise<void> => {
  await withinDeadline(
    harness.adapter.close(),
    "fallback adapter cleanup",
    CLEANUP_DEADLINE_MS,
  ).catch(() => undefined);
  const pgid = harness.getPgid();
  if (pgid > 0) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        (error.code !== "ESRCH" && error.code !== "EPERM")
      ) {
        throw error;
      }
    }
  }
  for (const configDir of harness.configDirs) {
    await rm(configDir, { recursive: true, force: true });
  }
};

type CapturedEvents = {
  canonical: Array<Record<string, unknown>>;
  legacy: Array<Record<string, unknown>>;
};

const captureEvents = (adapter: PiAdapter): CapturedEvents => {
  const captured: CapturedEvents = { canonical: [], legacy: [] };
  adapter.onCanonicalEvent((event: unknown) => {
    captured.canonical.push(event as Record<string, unknown>);
  });
  adapter.onEvent((event: unknown) => {
    captured.legacy.push(event as Record<string, unknown>);
  });
  return captured;
};

type FailureCase = {
  mode: FakePiMode;
  cleanup: "delete" | "close";
  expectedCodes: readonly PiAdapterErrorCode[];
  expectedCategory: PiRuntimeFailureCategory;
  beforePrompt?: (harness: RealHarness) => Promise<void>;
};

const FAILURE_CASES: readonly FailureCase[] = [
  {
    mode: "malformed-json",
    cleanup: "delete",
    expectedCodes: ["PI_RPC_PROTOCOL_ERROR"],
    expectedCategory: "protocol",
  },
  {
    mode: "null-record",
    cleanup: "close",
    expectedCodes: ["PI_RPC_PROTOCOL_ERROR"],
    expectedCategory: "protocol",
  },
  {
    mode: "primitive-record",
    cleanup: "delete",
    expectedCodes: ["PI_RPC_PROTOCOL_ERROR"],
    expectedCategory: "protocol",
  },
  {
    mode: "oversized-record",
    cleanup: "close",
    expectedCodes: ["PI_RPC_PROTOCOL_ERROR"],
    expectedCategory: "protocol",
  },
  {
    mode: "partial-eof",
    cleanup: "delete",
    expectedCodes: ["PI_RPC_PROTOCOL_ERROR"],
    expectedCategory: "protocol",
  },
  {
    mode: "epipe-write-close-race",
    cleanup: "close",
    expectedCodes: ["PI_RPC_STDIN_ERROR"],
    expectedCategory: "process",
    beforePrompt: async (harness) => {
      await withinDeadline(harness.stdinClosed, "fake Pi stdin close");
    },
  },
  {
    mode: "clean-early-exit",
    cleanup: "delete",
    expectedCodes: ["PI_RPC_PROCESS_EXIT"],
    expectedCategory: "process",
  },
  {
    mode: "nonzero-exit",
    cleanup: "close",
    expectedCodes: ["PI_RPC_PROCESS_EXIT"],
    expectedCategory: "process",
  },
  {
    mode: "signal-exit",
    cleanup: "delete",
    expectedCodes: ["PI_RPC_PROCESS_SIGNAL", "PI_RPC_PROCESS_EXIT"],
    expectedCategory: "process",
  },
  {
    mode: "request-timeout-hang",
    cleanup: "close",
    expectedCodes: ["PI_RPC_TIMEOUT"],
    expectedCategory: "process",
  },
];

describe.skipIf(process.platform === "win32")(
  "Unix real-process failure cleanup (unsupported on win32: negative-PID group probes are unavailable)",
  () => {
    for (const testCase of FAILURE_CASES) {
      it(`${testCase.mode} emits one safe typed failure and reaps all process/config state`, async () => {
        const harness = createRealHarness(testCase.mode);
        const captured = captureEvents(harness.adapter);
        let surfaced: unknown;
        let configDir = "";
        let sessionId = "";

        try {
          const session = await harness.adapter.createSession({});
          sessionId = session.id;
          await withinDeadline(harness.treeReady, "sterile descendant process");
          configDir = await expectSterileConfig(harness);
          await testCase.beforePrompt?.(harness);

          surfaced = await harness.adapter.sendPrompt(session.id, {
            parts: [{
              type: "text",
              text: testCase.mode === "epipe-write-close-race"
                ? "x".repeat(200_000)
                : `exercise ${testCase.mode}`,
            }],
          }).then(
            () => undefined,
            (error: unknown) => error,
          );

          const surfacedFailure = surfaced as {
            code?: unknown;
            runtimeFailure?: Record<string, unknown>;
          };
          expect(typeof surfacedFailure.code).toBe("string");
          const surfacedCode = surfacedFailure.code as PiAdapterErrorCode;
          expect(surfacedFailure.runtimeFailure).toMatchObject({
            schemaVersion: "runtime-failure-v1",
            category: testCase.expectedCategory,
          });
          expect(testCase.expectedCodes.includes(surfacedCode)).toBe(true);
          expect((await harness.adapter.getSession(session.id))?.status).toBe("error");

          const typedTerminals = captured.canonical.filter(
            (event) => event.kind === "session.error",
          );
          expect(typedTerminals).toEqual([
            expect.objectContaining({
              errorCode: surfacedCode,
              recoverable: surfacedCode === "PI_RPC_TIMEOUT",
              runtimeFailure: expect.objectContaining({
                schemaVersion: "runtime-failure-v1",
                category: testCase.expectedCategory,
                causeCode: surfacedCode,
              }),
            }),
          ]);
          expect(captured.legacy.filter((event) =>
            event.type === "session.status" &&
            (event.properties as Record<string, unknown>)?.status === "error"
          )).toHaveLength(1);
          expect(JSON.stringify({ surfaced: String(surfaced), captured })).not.toContain(
            RAW_FAKE_SENTINEL,
          );

          const cleanupOutcome = await (testCase.cleanup === "delete"
            ? withinDeadline(
                harness.adapter.deleteSession(session.id),
                `${testCase.mode} delete cleanup`,
                CLEANUP_DEADLINE_MS,
              )
            : withinDeadline(
                harness.adapter.close().then(() => true),
                `${testCase.mode} close cleanup`,
                CLEANUP_DEADLINE_MS,
              )
          ).catch((error: unknown) => error);
          expect(cleanupOutcome).toBe(true);

          await expectCleanupEvidence(harness, configDir);
          expect(await harness.adapter.getSession(session.id)).toBeNull();
        } finally {
          await forceCleanup(harness);
          if (sessionId && configDir) await expectPathMissing(configDir);
        }
      });
    }

    it("duplicate settlement produces one successful terminal and one cleanup", async () => {
      const harness = createRealHarness("duplicate-settlement");
      const captured = captureEvents(harness.adapter);
      const idle = signal();
      harness.adapter.onCanonicalEvent((event: unknown) => {
        if ((event as Record<string, unknown>).kind === "session.idle") idle.resolve();
      });
      let configDir = "";

      try {
        const session = await harness.adapter.createSession({});
        await withinDeadline(harness.treeReady, "duplicate-settlement descendant");
        configDir = await expectSterileConfig(harness);
        await harness.adapter.sendPrompt(session.id, {
          parts: [{ type: "text", text: "settle exactly once" }],
        });
        await withinDeadline(idle.promise, "duplicate-settlement terminal");

        expect(captured.canonical.filter((event) => event.kind === "session.idle"))
          .toHaveLength(1);
        expect(captured.canonical.filter((event) => event.kind === "session.error"))
          .toHaveLength(0);
        expect(captured.legacy.filter((event) => event.type === "session.idle"))
          .toHaveLength(1);
        expect(JSON.stringify(captured)).not.toContain(RAW_FAKE_SENTINEL);
        await expect(withinDeadline(
          harness.adapter.deleteSession(session.id),
          "duplicate-settlement delete cleanup",
          CLEANUP_DEADLINE_MS,
        )).resolves.toBe(true);
        await expectCleanupEvidence(harness, configDir);
      } finally {
        await forceCleanup(harness);
      }
    });

    it("successful settlement retains one terminal and full real-process cleanup", async () => {
      const harness = createRealHarness("success");
      const captured = captureEvents(harness.adapter);
      const idle = signal();
      harness.adapter.onCanonicalEvent((event: unknown) => {
        if ((event as Record<string, unknown>).kind === "session.idle") idle.resolve();
      });
      let configDir = "";

      try {
        const session = await harness.adapter.createSession({});
        await withinDeadline(harness.treeReady, "success descendant");
        configDir = await expectSterileConfig(harness);
        await harness.adapter.sendPrompt(session.id, {
          parts: [{ type: "text", text: "successful process regression" }],
        });
        await withinDeadline(idle.promise, "successful terminal");
        expect(captured.canonical.filter((event) => event.kind === "session.idle"))
          .toHaveLength(1);
        expect(captured.canonical.filter((event) => event.kind === "session.error"))
          .toHaveLength(0);
        await expect(withinDeadline(
          harness.adapter.close(),
          "successful close cleanup",
          CLEANUP_DEADLINE_MS,
        )).resolves.toBeUndefined();
        await expectCleanupEvidence(harness, configDir);
      } finally {
        await forceCleanup(harness);
      }
    });

    it("active cancellation retains one interrupted terminal and full real-process cleanup", async () => {
      const harness = createRealHarness("active");
      const captured = captureEvents(harness.adapter);
      let configDir = "";

      try {
        const session = await harness.adapter.createSession({});
        await withinDeadline(harness.treeReady, "cancellation descendant");
        configDir = await expectSterileConfig(harness);
        await harness.adapter.sendPrompt(session.id, {
          parts: [{ type: "text", text: "active cancellation regression" }],
        });
        await withinDeadline(harness.promptReady, "active cancellation prompt");
        await expect(withinDeadline(
          harness.adapter.abortSession(session.id),
          "active cancellation cleanup",
          CLEANUP_DEADLINE_MS,
        )).resolves.toBe(true);

        expect(captured.canonical.filter((event) => event.kind === "session.idle"))
          .toHaveLength(1);
        expect(captured.canonical.filter((event) => event.kind === "session.error"))
          .toHaveLength(0);
        expect(captured.canonical.filter((event) =>
          event.kind === "agent.tool_call.result" &&
          event.success === false &&
          event.outputPreview === "interrupted"
        )).toHaveLength(1);
        await expectCleanupEvidence(harness, configDir);
      } finally {
        await forceCleanup(harness);
      }
    });

    it("proves abort, delete, and close reap the entire real process group", async () => {
      for (const operation of ["abort", "delete", "close"] as const) {
        const harness = createRealHarness();
        let configDir = "";
        try {
          const session = await harness.adapter.createSession({});
          await withinDeadline(harness.treeReady, "sterile descendant process");
          configDir = await expectSterileConfig(harness);

          if (operation === "abort") {
            await harness.adapter.sendPrompt(session.id, {
              parts: [{ type: "text", text: "activate sterile tool" }],
            });
            await withinDeadline(harness.promptReady, "active sterile tool prompt");
            await expect(withinDeadline(
              harness.adapter.abortSession(session.id),
              "abort process cleanup",
              CLEANUP_DEADLINE_MS,
            )).resolves.toBe(true);
          } else if (operation === "delete") {
            await expect(withinDeadline(
              harness.adapter.deleteSession(session.id),
              "delete process cleanup",
              CLEANUP_DEADLINE_MS,
            )).resolves.toBe(true);
          } else {
            await expect(withinDeadline(
              harness.adapter.close(),
              "close process cleanup",
              CLEANUP_DEADLINE_MS,
            )).resolves.toBeUndefined();
          }

          await expectCleanupEvidence(harness, configDir);
        } finally {
          await forceCleanup(harness);
        }
      }
    });

    it("integrates active-tool cancellation with queued-prompt clearing and one terminal", async () => {
      const harness = createRealHarness();
      const canonical: Array<Record<string, unknown>> = [];
      const activeTool = signal();
      harness.adapter.onCanonicalEvent((event: unknown) => {
        const captured = event as Record<string, unknown>;
        canonical.push(captured);
        if (captured.kind === "agent.tool_call.start") activeTool.resolve();
      });
      const port = await getFreePort();
      const server = createShimServer({
        adapter: harness.adapter,
        host: "127.0.0.1",
        port,
        heartbeatIntervalMs: 60_000,
        logger: { info: () => {}, error: () => {} },
      });
      let configDir = "";

      try {
        await server.start();
        const baseUrl = `http://127.0.0.1:${port}`;
        const created = await fetch(`${baseUrl}/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        expect(created.status).toBe(200);
        const session = await created.json() as { id: string };
        await withinDeadline(harness.treeReady, "server cancellation descendant");
        configDir = await expectSterileConfig(harness);

        const active = await fetch(`${baseUrl}/session/${session.id}/prompt_async`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "active prompt" }),
        });
        expect(active.status).toBe(204);
        await withinDeadline(activeTool.promise, "active tool event");
        await withinDeadline(harness.promptReady, "server active prompt");

        for (const prompt of ["queued one", "queued two"]) {
          const queued = await fetch(
            `${baseUrl}/session/${session.id}/prompt_async`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ prompt }),
            },
          );
          expect(queued.status).toBe(204);
        }

        const aborted = await fetch(`${baseUrl}/session/${session.id}/abort`, {
          method: "POST",
        });
        expect(aborted.status).toBe(200);
        expect(await aborted.json()).toBe(true);

        expect(harness.getPromptCount()).toBe(1);
        expect(canonical.filter((event) => event.kind === "session.idle")).toHaveLength(1);
        expect(canonical.filter((event) =>
          event.kind === "agent.tool_call.result" &&
          event.success === false &&
          event.outputPreview === "interrupted"
        )).toHaveLength(1);
        await expectCleanupEvidence(harness, configDir);
      } finally {
        await server.stop().catch(() => undefined);
        await forceCleanup(harness);
      }
    });
  },
);
