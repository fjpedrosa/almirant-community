import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalEvent, CanonicalEventListener, NativeEventListener, NativeRuntimeEvent, PromptRequest, RuntimeAdapter, RuntimeEventListener, SessionCreateInput, SessionCreateResponse, SSEEvent } from "@almirant/shim-server";
import {
  computeSessionStatsDelta,
  createPiMappingContext,
  finalizePiTurn,
  mapPiEventToShim,
  projectPiNativeEvent,
  type PiMappingContext,
  type PiObservedSelection,
  type PiUsageSnapshot,
} from "./event-mapper.js";
import {
  JsonlObjectParser,
  PiRpcProtocolError,
  serializeJsonlObject,
} from "./jsonl.js";

export type PiTimerApi = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type PiChildProcess = {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdin: {
    write: (
      wire: Uint8Array,
      callback: (error?: Error | null) => void,
    ) => boolean;
    destroy?: () => void;
    on?: (
      event: string,
      listener: (...args: any[]) => void,
    ) => unknown;
  };
  stdout: {
    on: (event: string, listener: (...args: any[]) => void) => unknown;
  };
  stderr: { resume: () => unknown };
  on: (event: string, listener: (...args: any[]) => void) => unknown;
};

export type PiSpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ["pipe", "pipe", "pipe"];
  detached: boolean;
};

export type PiSpawnProcess = (
  command: string,
  args: readonly string[],
  options: PiSpawnOptions,
) => PiChildProcess;

export type PiAdapterOptions = {
  command?: string;
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  abortSettlementTimeoutMs?: number;
  terminateGraceMs?: number;
  reapTimeoutMs?: number;
  processGroupPollIntervalMs?: number;
  maxAutoRetryAttemptsPerTurn?: number;
  maxAutoRetryAttemptsPerSession?: number;
  spawnProcess?: PiSpawnProcess;
  terminateProcessGroup?: (
    pid: number,
    signal: NodeJS.Signals,
  ) => void | Promise<void>;
  probeProcessGroup?: (pid: number) => boolean | Promise<boolean>;
  timers?: PiTimerApi;
  makeConfigDir?: () => Promise<string>;
  removeConfigDir?: (path: string) => Promise<void>;
  createId?: () => string;
};

type PiResponse = {
  type: "response";
  id: string;
  command: string;
  success: boolean;
  data?: Record<string, unknown>;
};

type PendingRequest = {
  command: string;
  timeout: unknown;
  resolve: (response: PiResponse) => void;
  reject: (error: Error) => void;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  settled: boolean;
};

type PiTurnState = {
  context: PiMappingContext;
  baseline: PiUsageSnapshot;
  settlementStarted: boolean;
  settlement: Deferred<boolean>;
  autoRetryAttempts: number;
  unmatchedAutoRetryStarts: number;
};

type PiSessionState = {
  session: SessionCreateResponse;
  process: PiChildProcess;
  configDir: string;
  parser: JsonlObjectParser;
  pending: Map<string, PendingRequest>;
  completedResponseIds: Set<string>;
  phase: "starting" | "idle" | "running" | "settling" | "poisoned" | "closing" | "closed";
  turn?: PiTurnState;
  statsBaseline: PiUsageSnapshot;
  observedSelection?: PiObservedSelection;
  failureTerminalEmitted: boolean;
  processExited: Deferred<void>;
  exitObserved: boolean;
  cleanupPromise?: Promise<void>;
  configRemoved: boolean;
  autoRetryAttempts: number;
};

export type PiAdapterErrorCode =
  | "PI_RPC_AUTH_ERROR"
  | "PI_RPC_CONFIG_ERROR"
  | "PI_RPC_STATE_MISMATCH"
  | "PI_RPC_MODEL_ERROR"
  | "PI_RPC_ENDPOINT_ERROR"
  | "PI_RPC_PROTOCOL_ERROR"
  | "PI_RPC_PROCESS_EXIT"
  | "PI_RPC_PROCESS_SIGNAL"
  | "PI_RPC_STDIN_ERROR"
  | "PI_RPC_TIMEOUT"
  | "PI_RPC_CANCELLED"
  | "PI_RPC_COMMAND_FAILED"
  | "PI_RPC_PROCESS_REAP_TIMEOUT"
  | "PI_PROCESS_GROUP_NOT_REAPED"
  | "PI_RPC_USAGE_INTEGRITY_ERROR";

export type PiRuntimeFailureCategory =
  | "auth"
  | "model"
  | "endpoint"
  | "protocol"
  | "process"
  | "cancellation"
  | "usage"
  | "policy";

export type PiRuntimeFailureMetadata = Readonly<{
  schemaVersion: "runtime-failure-v1";
  code:
    | "RUNTIME_AUTH_FAILURE"
    | "RUNTIME_MODEL_FAILURE"
    | "RUNTIME_ENDPOINT_FAILURE"
    | "RUNTIME_PROTOCOL_FAILURE"
    | "RUNTIME_PROCESS_FAILURE"
    | "RUNTIME_CANCELLED"
    | "RUNTIME_USAGE_INTEGRITY_FAILURE"
    | "RUNTIME_POLICY_FAILURE";
  category: PiRuntimeFailureCategory;
  retryable: boolean;
  message: string;
  causeCode: PiAdapterErrorCode;
}>;

const PI_RUNTIME_FAILURES = {
  PI_RPC_AUTH_ERROR: {
    code: "RUNTIME_AUTH_FAILURE",
    category: "auth",
    retryable: false,
    message: "Runtime authentication failed.",
  },
  PI_RPC_CONFIG_ERROR: {
    code: "RUNTIME_POLICY_FAILURE",
    category: "policy",
    retryable: false,
    message: "Runtime policy rejected the operation.",
  },
  PI_RPC_STATE_MISMATCH: {
    code: "RUNTIME_MODEL_FAILURE",
    category: "model",
    retryable: false,
    message: "Runtime model selection failed.",
  },
  PI_RPC_MODEL_ERROR: {
    code: "RUNTIME_MODEL_FAILURE",
    category: "model",
    retryable: false,
    message: "Runtime model selection failed.",
  },
  PI_RPC_ENDPOINT_ERROR: {
    code: "RUNTIME_ENDPOINT_FAILURE",
    category: "endpoint",
    retryable: false,
    message: "Runtime endpoint is unavailable.",
  },
  PI_RPC_PROTOCOL_ERROR: {
    code: "RUNTIME_PROTOCOL_FAILURE",
    category: "protocol",
    retryable: false,
    message: "Runtime protocol validation failed.",
  },
  PI_RPC_PROCESS_EXIT: {
    code: "RUNTIME_PROCESS_FAILURE",
    category: "process",
    retryable: false,
    message: "Runtime process failed.",
  },
  PI_RPC_PROCESS_SIGNAL: {
    code: "RUNTIME_PROCESS_FAILURE",
    category: "process",
    retryable: false,
    message: "Runtime process failed.",
  },
  PI_RPC_STDIN_ERROR: {
    code: "RUNTIME_PROCESS_FAILURE",
    category: "process",
    retryable: false,
    message: "Runtime process failed.",
  },
  PI_RPC_TIMEOUT: {
    code: "RUNTIME_PROCESS_FAILURE",
    category: "process",
    retryable: true,
    message: "Runtime process failed.",
  },
  PI_RPC_CANCELLED: {
    code: "RUNTIME_CANCELLED",
    category: "cancellation",
    retryable: false,
    message: "Runtime operation was cancelled.",
  },
  PI_RPC_COMMAND_FAILED: {
    code: "RUNTIME_PROCESS_FAILURE",
    category: "process",
    retryable: false,
    message: "Runtime process failed.",
  },
  PI_RPC_PROCESS_REAP_TIMEOUT: {
    code: "RUNTIME_PROCESS_FAILURE",
    category: "process",
    retryable: false,
    message: "Runtime process failed.",
  },
  PI_PROCESS_GROUP_NOT_REAPED: {
    code: "RUNTIME_PROCESS_FAILURE",
    category: "process",
    retryable: false,
    message: "Runtime process failed.",
  },
  PI_RPC_USAGE_INTEGRITY_ERROR: {
    code: "RUNTIME_USAGE_INTEGRITY_FAILURE",
    category: "usage",
    retryable: false,
    message: "Runtime usage integrity validation failed.",
  },
} as const satisfies Record<
  PiAdapterErrorCode,
  Omit<PiRuntimeFailureMetadata, "schemaVersion" | "causeCode">
>;

const piRuntimeFailure = (
  causeCode: PiAdapterErrorCode,
): PiRuntimeFailureMetadata =>
  Object.freeze({
    schemaVersion: "runtime-failure-v1",
    ...PI_RUNTIME_FAILURES[causeCode],
    causeCode,
  });

const piCanonicalErrorCategory = (
  category: PiRuntimeFailureCategory,
): "agent" | "infra" | "config" => {
  switch (category) {
    case "auth":
    case "model":
    case "endpoint":
    case "policy":
      return "config";
    case "usage":
      return "agent";
    case "protocol":
    case "process":
    case "cancellation":
      return "infra";
  }
};

export class PiAdapterError extends Error {
  public readonly code: PiAdapterErrorCode;
  public readonly runtimeFailure: PiRuntimeFailureMetadata;
  public readonly category: PiRuntimeFailureCategory;
  public readonly retryable: boolean;

  constructor(code: PiAdapterErrorCode, _safeDetail: string) {
    const runtimeFailure = piRuntimeFailure(code);
    super(`${code}: ${runtimeFailure.message}`);
    this.name = "PiAdapterError";
    this.code = code;
    this.runtimeFailure = runtimeFailure;
    this.category = runtimeFailure.category;
    this.retryable = runtimeFailure.retryable;
  }
}

const STERILE_PI_ARGS = [
  "--mode",
  "rpc",
  "--no-session",
  "--offline",
  "--no-context-files",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
  "--no-approve",
] as const;

const BUILT_IN_TOOL_ALLOWLIST = "read,bash,edit,write,grep,find,ls";
const DEFAULT_PI_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const DEFAULT_PROCESS_GROUP_POLL_INTERVAL_MS = 25;
const DEFAULT_MAX_AUTO_RETRY_ATTEMPTS_PER_TURN = 3;
const DEFAULT_MAX_AUTO_RETRY_ATTEMPTS_PER_SESSION = 32;
const PI_CHILD_PASSTHROUGH_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "ZAI_API_KEY",
] as const;

const buildPiChildEnvironment = (input: {
  source: NodeJS.ProcessEnv;
  configDir: string;
  cwd: string;
  provider: string;
  model: string;
  thinking?: string;
}): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of PI_CHILD_PASSTHROUGH_ENV_KEYS) {
    const value = input.source[key];
    if (typeof value === "string" && value.length > 0) environment[key] = value;
  }

  environment.PATH = input.source.PATH ?? DEFAULT_PI_PATH;
  environment.HOME = input.source.HOME ?? "/home/opencode";
  environment.TMPDIR = input.source.TMPDIR ?? "/tmp";
  environment.TMP = input.source.TMP ?? "/tmp";
  environment.TEMP = input.source.TEMP ?? "/tmp";
  environment.WORKSPACE_REPO_PATH = input.cwd;
  environment.PI_PROVIDER = input.provider;
  environment.PI_MODEL = input.model;
  if (input.thinking) environment.PI_THINKING_LEVEL = input.thinking;
  environment.PI_CODING_AGENT_DIR = input.configDir;
  environment.PI_OFFLINE = "1";
  environment.PI_TELEMETRY = "0";
  environment.PI_SKIP_VERSION_CHECK = "1";
  return environment;
};

const requireSelection = (name: "provider" | "model", value: string): string => {
  if (value.length === 0 || value.trim() !== value) {
    throw new PiAdapterError("PI_RPC_CONFIG_ERROR", `${name} is required exactly as requested`);
  }
  return value;
};

const requireSessionCwd = (value: string | undefined): string => {
  if (!value || value.trim() !== value) {
    throw new PiAdapterError("PI_RPC_CONFIG_ERROR", "cwd is required exactly as configured");
  }
  return value;
};

export const buildPiCommand = (input: {
  provider: string;
  model: string;
  thinking?: string;
}): string[] => {
  const provider = requireSelection("provider", input.provider);
  const model = requireSelection("model", input.model);
  const args = [
    ...STERILE_PI_ARGS,
    "--tools",
    BUILT_IN_TOOL_ALLOWLIST,
    "--provider",
    provider,
    "--model",
    model,
  ];
  if (input.thinking !== undefined) {
    if (input.thinking.length === 0 || input.thinking.trim() !== input.thinking) {
      throw new PiAdapterError("PI_RPC_CONFIG_ERROR", "thinking must be passed exactly as requested");
    }
    args.push("--thinking", input.thinking);
  }
  return args;
};

const deferred = <T>(): Deferred<T> => {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const result: Deferred<T> = {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve: (value) => {
      if (result.settled) return;
      result.settled = true;
      resolvePromise(value);
    },
    reject: (error) => {
      if (result.settled) return;
      result.settled = true;
      rejectPromise(error);
    },
    settled: false,
  };
  return result;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finiteNonNegative = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const promptTextFromRequest = (request: PromptRequest): string =>
  request.parts.map((part: { text: string }) => part.text).join("\n").trim();

const defaultTimers: PiTimerApi = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const defaultSpawn: PiSpawnProcess = (command, args, options) =>
  spawn(command, [...args], options) as unknown as PiChildProcess;

const defaultTerminateProcessGroup = (
  pid: number,
  signal: NodeJS.Signals,
): void => {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!isRecord(error) || error.code !== "ESRCH") throw error;
  }
};

const defaultProbeProcessGroup = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ESRCH") return false;
    // POSIX EPERM still proves that the process group exists. Treat it as alive
    // so a transient post-signal probe cannot abandon config/process cleanup.
    if (isRecord(error) && error.code === "EPERM") return true;
    throw error;
  }
};

const positiveSafeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PiAdapterError(
      "PI_RPC_CONFIG_ERROR",
      `${name} must be a positive safe integer`,
    );
  }
  return value;
};

const defaultMakeConfigDir = (): Promise<string> =>
  mkdtemp(join(tmpdir(), "almirant-pi-"));

const defaultRemoveConfigDir = (path: string): Promise<void> =>
  rm(path, { recursive: true, force: true });

const safeError = (
  error: unknown,
  fallbackCode: PiAdapterErrorCode,
  detail: string,
): PiAdapterError => {
  if (error instanceof PiAdapterError) return error;
  if (error instanceof PiRpcProtocolError) {
    return new PiAdapterError("PI_RPC_PROTOCOL_ERROR", error.code);
  }
  return new PiAdapterError(fallbackCode, detail);
};

const assertSuccess = (response: PiResponse): void => {
  if (!response.success) {
    throw new PiAdapterError(
      "PI_RPC_COMMAND_FAILED",
      `Pi rejected ${response.command}`,
    );
  }
};

const observedSelection = (
  data: Record<string, unknown> | undefined,
): { provider?: string; model?: string; thinking?: string } => {
  const modelRecord = isRecord(data?.model) ? data.model : undefined;
  return {
    provider:
      typeof modelRecord?.provider === "string"
        ? modelRecord.provider
        : typeof data?.provider === "string"
          ? data.provider
          : undefined,
    model:
      typeof modelRecord?.id === "string"
        ? modelRecord.id
        : typeof data?.model === "string"
          ? data.model
          : undefined,
    thinking:
      typeof data?.thinkingLevel === "string"
        ? data.thinkingLevel
        : typeof data?.thinking === "string"
          ? data.thinking
          : undefined,
  };
};

const assertObservedSelection = (
  response: PiResponse,
  requested: { provider: string; model: string; thinking?: string },
): PiObservedSelection => {
  const observed = observedSelection(response.data);
  if (
    observed.provider !== requested.provider ||
    observed.model !== requested.model ||
    (requested.thinking !== undefined && observed.thinking !== requested.thinking)
  ) {
    throw new PiAdapterError(
      "PI_RPC_STATE_MISMATCH",
      "get_state did not exactly match the requested provider/model/thinking",
    );
  }
  return {
    codingAgent: "pi",
    aiProvider: observed.provider,
    model: observed.model,
    ...(observed.thinking ? { reasoningLevel: observed.thinking } : {}),
  };
};

const parseSessionStats = (
  data: Record<string, unknown> | undefined,
): PiUsageSnapshot | undefined => {
  const rawTokens = data?.tokens;
  if (rawTokens === undefined) return undefined;
  if (!isRecord(rawTokens)) {
    throw new PiAdapterError(
      "PI_RPC_USAGE_INTEGRITY_ERROR",
      "Pi session usage payload was malformed",
    );
  }
  if (Object.keys(rawTokens).length === 0) return undefined;

  const result: PiUsageSnapshot = {};
  const sourceToTarget = [
    ["input", "input"],
    ["output", "output"],
    ["cacheRead", "cacheRead"],
    ["cacheWrite", "cacheWrite"],
    ["total", "totalTokens"],
  ] as const;
  for (const [source, target] of sourceToTarget) {
    const value = finiteNonNegative(rawTokens[source]);
    if (value === undefined) {
      throw new PiAdapterError(
        "PI_RPC_USAGE_INTEGRITY_ERROR",
        "Pi session usage payload violated its integrity contract",
      );
    }
    result[target] = value;
  }
  return result;
};

export class PiAdapter implements RuntimeAdapter {
  private readonly sessions = new Map<string, PiSessionState>();
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly canonicalListeners = new Set<CanonicalEventListener>();
  private readonly nativeListeners = new Set<NativeEventListener>();
  private readonly command: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly startupTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly abortSettlementTimeoutMs: number;
  private readonly terminateGraceMs: number;
  private readonly reapTimeoutMs: number;
  private readonly processGroupPollIntervalMs: number;
  private readonly maxAutoRetryAttemptsPerTurn: number;
  private readonly maxAutoRetryAttemptsPerSession: number;
  private readonly spawnProcess: PiSpawnProcess;
  private readonly terminateProcessGroup: PiAdapterOptions["terminateProcessGroup"] & {};
  private readonly probeProcessGroup: PiAdapterOptions["probeProcessGroup"] & {};
  private readonly timers: PiTimerApi;
  private readonly makeConfigDir: () => Promise<string>;
  private readonly removeConfigDir: (path: string) => Promise<void>;
  private readonly createId: () => string;

  constructor(options: PiAdapterOptions = {}) {
    this.command = options.command ?? "pi";
    this.env = options.env ?? process.env;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.abortSettlementTimeoutMs = options.abortSettlementTimeoutMs ?? 10_000;
    this.terminateGraceMs = options.terminateGraceMs ?? 2_000;
    this.reapTimeoutMs = options.reapTimeoutMs ?? 4_000;
    this.processGroupPollIntervalMs = positiveSafeInteger(
      options.processGroupPollIntervalMs ?? DEFAULT_PROCESS_GROUP_POLL_INTERVAL_MS,
      "processGroupPollIntervalMs",
    );
    this.maxAutoRetryAttemptsPerTurn = positiveSafeInteger(
      options.maxAutoRetryAttemptsPerTurn ?? DEFAULT_MAX_AUTO_RETRY_ATTEMPTS_PER_TURN,
      "maxAutoRetryAttemptsPerTurn",
    );
    this.maxAutoRetryAttemptsPerSession = positiveSafeInteger(
      options.maxAutoRetryAttemptsPerSession ?? DEFAULT_MAX_AUTO_RETRY_ATTEMPTS_PER_SESSION,
      "maxAutoRetryAttemptsPerSession",
    );
    this.spawnProcess = options.spawnProcess ?? defaultSpawn;
    this.terminateProcessGroup = options.terminateProcessGroup ?? defaultTerminateProcessGroup;
    this.probeProcessGroup = options.probeProcessGroup ?? defaultProbeProcessGroup;
    this.timers = options.timers ?? defaultTimers;
    this.makeConfigDir = options.makeConfigDir ?? defaultMakeConfigDir;
    this.removeConfigDir = options.removeConfigDir ?? defaultRemoveConfigDir;
    this.createId = options.createId ?? randomUUID;
  }

  public onEvent(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public onCanonicalEvent(listener: CanonicalEventListener): () => void {
    this.canonicalListeners.add(listener);
    return () => this.canonicalListeners.delete(listener);
  }

  public onNativeEvent(listener: NativeEventListener): () => void {
    this.nativeListeners.add(listener);
    return () => this.nativeListeners.delete(listener);
  }

  public async createSession(
    input: Partial<SessionCreateInput>,
  ): Promise<SessionCreateResponse> {
    // The runner injects the admitted selection into the shim environment.
    // Shim-server session creation currently sends an empty provider/model body,
    // and request fields must never override that runner-owned selection.
    const cwd = requireSessionCwd(
      this.env.WORKSPACE_REPO_PATH ?? input.cwd,
    );
    const provider = requireSelection(
      "provider",
      this.env.PI_PROVIDER ?? input.provider ?? "",
    );
    const model = requireSelection(
      "model",
      this.env.PI_MODEL ?? input.model ?? "",
    );
    const thinking = this.env.PI_THINKING_LEVEL ?? this.env.REASONING_BUDGET;
    const requested = { provider, model, ...(thinking ? { thinking } : {}) };
    const args = buildPiCommand(requested);
    const configDir = await this.makeConfigDir();
    let child: PiChildProcess;

    try {
      child = this.spawnProcess(this.command, args, {
        cwd,
        env: buildPiChildEnvironment({
          source: this.env,
          configDir,
          cwd,
          provider,
          model,
          ...(thinking ? { thinking } : {}),
        }),
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (error) {
      await this.removeConfigDir(configDir);
      throw safeError(error, "PI_RPC_PROCESS_EXIT", "Pi failed to spawn");
    }

    if (!Number.isSafeInteger(child.pid) || (child.pid ?? 0) <= 0) {
      await this.removeConfigDir(configDir);
      throw new PiAdapterError("PI_RPC_PROCESS_EXIT", "Pi child did not expose a process id");
    }

    const id = this.createId();
    const now = new Date().toISOString();
    const state: PiSessionState = {
      session: {
        id,
        cwd,
        model,
        provider,
        status: "starting",
        createdAt: now,
        updatedAt: now,
        metadata: input.metadata,
      },
      process: child,
      configDir,
      parser: new JsonlObjectParser(),
      pending: new Map(),
      completedResponseIds: new Set(),
      phase: "starting",
      statsBaseline: {},
      failureTerminalEmitted: false,
      processExited: deferred<void>(),
      exitObserved: false,
      configRemoved: false,
      autoRetryAttempts: 0,
    };
    this.sessions.set(id, state);
    this.attachProcess(state);

    try {
      const response = await this.request(
        state,
        { type: "get_state" },
        this.startupTimeoutMs,
      );
      assertSuccess(response);
      state.observedSelection = assertObservedSelection(response, requested);
      state.phase = "idle";
      state.session.status = "idle";
      state.session.updatedAt = new Date().toISOString();
      return state.session;
    } catch (error) {
      this.sessions.delete(id);
      await this.destroyState(state, "Pi startup failed");
      throw safeError(error, "PI_RPC_PROTOCOL_ERROR", "Pi startup failed");
    }
  }

  public async listSessions(): Promise<SessionCreateResponse[]> {
    return [...this.sessions.values()].map((state) => state.session);
  }

  public async getSession(
    sessionId: string,
  ): Promise<SessionCreateResponse | null> {
    return this.sessions.get(sessionId)?.session ?? null;
  }

  public async sendPrompt(
    sessionId: string,
    request: PromptRequest,
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) throw new PiAdapterError("PI_RPC_CONFIG_ERROR", "unknown Pi session");
    const message = promptTextFromRequest(request);
    if (!message) return;
    if (state.phase !== "idle") {
      throw new PiAdapterError("PI_RPC_PROTOCOL_ERROR", "Pi session is not idle");
    }

    const turn: PiTurnState = {
      context: createPiMappingContext(),
      baseline: { ...state.statsBaseline },
      settlementStarted: false,
      settlement: deferred<boolean>(),
      autoRetryAttempts: 0,
      unmatchedAutoRetryStarts: 0,
    };
    state.turn = turn;
    state.failureTerminalEmitted = false;
    state.phase = "running";
    state.session.status = "running";
    state.session.updatedAt = new Date().toISOString();
    this.emit({
      type: "session.status",
      properties: { sessionId, status: "running" },
    });

    try {
      const response = await this.request(state, { type: "prompt", message });
      assertSuccess(response);
    } catch (error) {
      const safe = safeError(error, "PI_RPC_COMMAND_FAILED", "Pi prompt failed");
      this.poison(state, safe);
      throw safe;
    }
  }

  public async abortSession(sessionId: string): Promise<boolean> {
    const state = this.sessions.get(sessionId);
    if (!state) return false;

    let operationError: PiAdapterError | undefined;
    try {
      if (state.phase === "running" && state.turn) {
        const turn = state.turn;
        turn.context.aborted = true;
        const response = await this.request(state, { type: "abort" });
        assertSuccess(response);
        const settled = await this.waitBounded(
          turn.settlement.promise,
          this.abortSettlementTimeoutMs,
        );
        if (!settled) {
          throw new PiAdapterError(
            "PI_RPC_CANCELLED",
            "Pi abort settlement timed out",
          );
        }
      } else if (state.phase === "settling" && state.turn) {
        const settled = await this.waitBounded(
          state.turn.settlement.promise,
          this.abortSettlementTimeoutMs,
        );
        if (!settled) {
          throw new PiAdapterError(
            "PI_RPC_CANCELLED",
            "Pi abort settlement timed out",
          );
        }
      } else if (state.phase !== "idle") {
        throw new PiAdapterError(
          "PI_RPC_CANCELLED",
          "Pi session cannot be aborted",
        );
      }
    } catch (error) {
      operationError = safeError(error, "PI_RPC_CANCELLED", "Pi abort failed");
      this.poison(state, operationError);
    }

    this.sessions.delete(sessionId);
    try {
      await this.destroyState(state, "Pi session aborted");
    } catch (error) {
      throw safeError(
        error,
        "PI_RPC_PROCESS_EXIT",
        "Pi abort cleanup failed",
      );
    }

    if (operationError) throw operationError;
    return true;
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    const state = this.sessions.get(sessionId);
    if (!state) return false;
    this.sessions.delete(sessionId);
    await this.destroyState(state, "Pi session deleted");
    return true;
  }

  public async close(): Promise<void> {
    const states = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(states.map((state) => this.destroyState(state, "Pi adapter closed")));
  }

  private attachProcess(state: PiSessionState): void {
    state.process.stderr.resume();
    state.process.stdin.on?.("error", () => {
      if (state.pending.size === 0) return;
      this.poison(
        state,
        new PiAdapterError("PI_RPC_STDIN_ERROR", "Pi stdin failed"),
      );
    });
    state.process.stdout.on("data", (chunk: Uint8Array | string) => {
      if (state.phase === "closing" || state.phase === "closed" || state.phase === "poisoned") return;
      try {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        for (const event of state.parser.push(bytes)) this.handleRecord(state, event);
      } catch (error) {
        this.poison(
          state,
          safeError(error, "PI_RPC_PROTOCOL_ERROR", "invalid Pi stdout framing"),
        );
      }
    });
    state.process.stdout.on("end", () => {
      if (state.phase === "closing" || state.phase === "closed" || state.exitObserved) return;
      try {
        state.parser.end();
        this.poison(
          state,
          new PiAdapterError("PI_RPC_PROCESS_EXIT", "Pi stdout ended unexpectedly"),
        );
      } catch (error) {
        this.poison(
          state,
          safeError(error, "PI_RPC_PROTOCOL_ERROR", "Pi stdout ended with a partial record"),
        );
      }
    });
    state.process.stdout.on("error", () => {
      this.poison(
        state,
        new PiAdapterError("PI_RPC_PROCESS_EXIT", "Pi stdout failed"),
      );
    });
    state.process.on("error", () => {
      this.poison(
        state,
        new PiAdapterError("PI_RPC_PROCESS_EXIT", "Pi child process failed"),
      );
    });
    state.process.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.observeExit(state);
      if (state.phase === "closing" || state.phase === "closed") return;
      this.poison(
        state,
        signal
          ? new PiAdapterError("PI_RPC_PROCESS_SIGNAL", `Pi exited from ${signal}`)
          : new PiAdapterError("PI_RPC_PROCESS_EXIT", `Pi exited with code ${code ?? "unknown"}`),
      );
    });
    state.process.on("close", () => {
      this.observeExit(state);
      if (state.phase === "closing" || state.phase === "closed" || state.phase === "poisoned") return;
      this.poison(
        state,
        new PiAdapterError("PI_RPC_PROCESS_EXIT", "Pi process closed unexpectedly"),
      );
    });
  }

  private observeExit(state: PiSessionState): void {
    if (state.exitObserved) return;
    state.exitObserved = true;
    state.processExited.resolve(undefined);
  }

  private handleRecord(
    state: PiSessionState,
    event: Record<string, unknown>,
  ): void {
    if (event.type === "response") {
      this.handleResponse(state, event);
      return;
    }

    const eventType = typeof event.type === "string" ? event.type : undefined;
    if (eventType === "agent_settled") {
      if (state.turn?.settlementStarted) return;
      if (state.phase !== "running" || !state.turn) {
        this.poison(
          state,
          new PiAdapterError("PI_RPC_PROTOCOL_ERROR", "unexpected agent_settled"),
        );
        return;
      }
    } else if (state.phase !== "running" || !state.turn) {
      this.poison(
        state,
        new PiAdapterError("PI_RPC_PROTOCOL_ERROR", "event arrived outside an active turn"),
      );
      return;
    }

    if (
      (eventType === "auto_retry_start" || eventType === "auto_retry_end") &&
      !this.recordAutoRetryAttempt(state, eventType)
    ) {
      return;
    }

    const projection = projectPiNativeEvent(event);
    if (projection) {
      const nativeEvent: NativeRuntimeEvent & {
        aiProvider: string;
        model: string;
      } = {
        nativeEventType: eventType ?? "unknown",
        sourceFormat: "pi-rpc",
        runtimeSessionId: state.session.id,
        codingAgent: "pi",
        aiProvider: state.observedSelection?.aiProvider ?? state.session.provider!,
        model: state.observedSelection?.model ?? state.session.model!,
        payload: projection,
      };
      this.emitNative(nativeEvent);
    }

    try {
      // The sterile child environment and empty config directory expose no
      // endpoint override, so only Pi's built-in Z.AI endpoint is trusted here.
      const trustedFixedEndpointProvider =
        state.session.provider === "zai" &&
          state.observedSelection?.aiProvider === "zai"
          ? "zai"
          : undefined;
      const mapped = mapPiEventToShim(
        state.session.id,
        event,
        state.turn.context,
        { trustedFixedEndpointProvider },
      );
      for (const shimEvent of mapped.events) this.emit(shimEvent as SSEEvent);
      for (const canonicalEvent of mapped.canonicalEvents) {
        this.emitCanonical(canonicalEvent as CanonicalEvent);
      }
      if (mapped.failureCode === "PI_RPC_AUTH_ERROR") {
        this.poison(
          state,
          new PiAdapterError(
            "PI_RPC_AUTH_ERROR",
            "Trusted fixed provider endpoint rejected authentication",
          ),
        );
        return;
      }
      if (mapped.settlement) this.startSettlement(state);
    } catch (error) {
      this.poison(
        state,
        safeError(error, "PI_RPC_PROTOCOL_ERROR", "invalid Pi event"),
      );
    }
  }

  private recordAutoRetryAttempt(
    state: PiSessionState,
    eventType: "auto_retry_start" | "auto_retry_end",
  ): boolean {
    const turn = state.turn;
    if (!turn) return false;

    let startsAttempt = false;
    if (eventType === "auto_retry_start") {
      turn.unmatchedAutoRetryStarts += 1;
      startsAttempt = true;
    } else if (turn.unmatchedAutoRetryStarts > 0) {
      turn.unmatchedAutoRetryStarts -= 1;
    } else {
      startsAttempt = true;
    }

    if (!startsAttempt) return true;
    turn.autoRetryAttempts += 1;
    state.autoRetryAttempts += 1;
    if (
      turn.autoRetryAttempts > this.maxAutoRetryAttemptsPerTurn ||
      state.autoRetryAttempts > this.maxAutoRetryAttemptsPerSession
    ) {
      this.poison(
        state,
        new PiAdapterError(
          "PI_RPC_PROTOCOL_ERROR",
          "Pi auto-retry limit exceeded",
        ),
      );
      return false;
    }
    return true;
  }

  private handleResponse(
    state: PiSessionState,
    event: Record<string, unknown>,
  ): void {
    const id = typeof event.id === "string" && event.id.length > 0 ? event.id : undefined;
    const command = typeof event.command === "string" ? event.command : undefined;
    const success = typeof event.success === "boolean" ? event.success : undefined;
    if (!id || !command || success === undefined) {
      this.poison(
        state,
        new PiAdapterError("PI_RPC_PROTOCOL_ERROR", "malformed Pi response"),
      );
      return;
    }
    if (state.completedResponseIds.has(id)) {
      this.poison(
        state,
        new PiAdapterError("PI_RPC_PROTOCOL_ERROR", "duplicate Pi response"),
      );
      return;
    }
    const pending = state.pending.get(id);
    if (!pending || pending.command !== command) {
      this.poison(
        state,
        new PiAdapterError("PI_RPC_PROTOCOL_ERROR", "unknown or mismatched Pi response"),
      );
      return;
    }
    if (event.data !== undefined && !isRecord(event.data)) {
      this.poison(
        state,
        new PiAdapterError("PI_RPC_PROTOCOL_ERROR", "Pi response data is malformed"),
      );
      return;
    }

    this.timers.clearTimeout(pending.timeout);
    state.pending.delete(id);
    state.completedResponseIds.add(id);
    pending.resolve({
      type: "response",
      id,
      command,
      success,
      ...(isRecord(event.data) ? { data: event.data } : {}),
    });
  }

  private startSettlement(state: PiSessionState): void {
    const turn = state.turn;
    if (!turn || turn.settlementStarted) return;
    turn.settlementStarted = true;
    state.phase = "settling";
    state.session.status = "settling";
    void this.finalizeSettlement(state, turn);
  }

  private async finalizeSettlement(
    state: PiSessionState,
    turn: PiTurnState,
  ): Promise<void> {
    try {
      const response = await this.request(state, { type: "get_session_stats" });
      const currentStats = response.success
        ? parseSessionStats(response.data)
        : undefined;
      let delta: PiUsageSnapshot | undefined;
      if (currentStats) {
        try {
          delta = computeSessionStatsDelta(currentStats, turn.baseline);
        } catch {
          throw new PiAdapterError(
            "PI_RPC_USAGE_INTEGRITY_ERROR",
            "Pi session usage aggregate regressed",
          );
        }
        state.statsBaseline = currentStats;
      }
      const terminal = finalizePiTurn(state.session.id, turn.context, {
        sessionStatsDelta: delta,
        observedSelection: state.observedSelection,
      });

      state.phase = "idle";
      state.session.status = "idle";
      state.session.updatedAt = new Date().toISOString();
      for (const event of terminal.events) this.emit(event as SSEEvent);
      for (const event of terminal.canonicalEvents) {
        this.emitCanonical(event as CanonicalEvent);
      }
      turn.settlement.resolve(true);
    } catch (error) {
      const safe = safeError(error, "PI_RPC_PROTOCOL_ERROR", "Pi settlement failed");
      this.poison(state, safe);
      turn.settlement.resolve(false);
    }
  }

  private request(
    state: PiSessionState,
    command: Record<string, unknown> & { type: string },
    timeoutMs = this.requestTimeoutMs,
  ): Promise<PiResponse> {
    if (state.phase === "poisoned" || state.phase === "closing" || state.phase === "closed") {
      return Promise.reject(new PiAdapterError("PI_RPC_CANCELLED", "Pi session is closed"));
    }
    const id = this.createId();
    if (state.pending.has(id) || state.completedResponseIds.has(id)) {
      const error = new PiAdapterError("PI_RPC_PROTOCOL_ERROR", "duplicate local request id");
      this.poison(state, error);
      return Promise.reject(error);
    }

    let wire: Uint8Array;
    try {
      wire = serializeJsonlObject({ ...command, id });
    } catch (error) {
      const safe = safeError(error, "PI_RPC_PROTOCOL_ERROR", "Pi request serialization failed");
      this.poison(state, safe);
      return Promise.reject(safe);
    }

    return new Promise<PiResponse>((resolve, reject) => {
      const timeout = this.timers.setTimeout(() => {
        const pending = state.pending.get(id);
        if (!pending) return;
        state.pending.delete(id);
        const error = new PiAdapterError("PI_RPC_TIMEOUT", `${command.type} timed out`);
        pending.reject(error);
        this.poison(state, error);
      }, timeoutMs);
      state.pending.set(id, { command: command.type, timeout, resolve, reject });

      const handleWriteError = (error?: Error | null): void => {
        if (!error) return;
        const pending = state.pending.get(id);
        if (!pending) {
          // A response or process exit can settle the request before libuv
          // reports a late EPIPE from the same write.
          return;
        }
        const safe = new PiAdapterError("PI_RPC_STDIN_ERROR", "Pi stdin write failed");
        this.timers.clearTimeout(pending.timeout);
        state.pending.delete(id);
        pending.reject(safe);
        this.poison(state, safe);
      };

      try {
        state.process.stdin.write(wire, handleWriteError);
      } catch {
        handleWriteError(new Error("stdin write threw"));
      }
    });
  }

  private poison(state: PiSessionState, error: PiAdapterError): void {
    if (state.phase === "poisoned" || state.phase === "closing" || state.phase === "closed") return;
    state.phase = "poisoned";
    state.session.status = "error";
    state.session.updatedAt = new Date().toISOString();

    for (const pending of state.pending.values()) {
      this.timers.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    state.pending.clear();
    state.turn?.settlement.resolve(false);

    if (!state.failureTerminalEmitted) {
      state.failureTerminalEmitted = true;
      const context = state.turn?.context ?? createPiMappingContext();
      context.failed = true;
      const terminal = finalizePiTurn(state.session.id, context, {
        observedSelection: state.observedSelection,
        failureCode: error.code,
      });
      for (const event of terminal.events) {
        const enriched =
          event.type === "session.status" && event.properties.status === "error"
            ? {
                ...event,
                properties: {
                  ...event.properties,
                  runtimeFailure: error.runtimeFailure,
                },
              }
            : event;
        this.emit(enriched as SSEEvent);
      }
      for (const event of terminal.canonicalEvents) {
        const enriched =
          event.kind === "session.error"
            ? {
                ...event,
                message: error.runtimeFailure.message,
                recoverable: error.retryable,
                errorCode: error.code,
                errorCategory: piCanonicalErrorCategory(error.category),
                runtimeFailure: error.runtimeFailure,
              }
            : event;
        this.emitCanonical(enriched as CanonicalEvent);
      }
    }

    void this.terminateAndReap(state).catch(() => undefined);
  }

  private async destroyState(
    state: PiSessionState,
    reason: string,
  ): Promise<void> {
    if (state.phase !== "closed") state.phase = "closing";
    const error = new PiAdapterError("PI_RPC_CANCELLED", reason);
    for (const pending of state.pending.values()) {
      this.timers.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    state.pending.clear();
    state.turn?.settlement.resolve(false);
    try {
      await this.terminateAndReap(state);
    } finally {
      state.phase = "closed";
      try {
        state.process.stdin.destroy?.();
      } catch {
        // The process group result remains authoritative over a late stdin race.
      }
    }
  }

  private terminateAndReap(state: PiSessionState): Promise<void> {
    if (state.cleanupPromise) return state.cleanupPromise;
    state.cleanupPromise = (async () => {
      let deadlineExpired = false;
      let deadlineTimer: unknown;
      const deadlineError = (): PiAdapterError =>
        new PiAdapterError(
          "PI_PROCESS_GROUP_NOT_REAPED",
          "Pi process group was not empty before the cleanup deadline",
        );
      const deadline = new Promise<never>((_resolve, reject) => {
        deadlineTimer = this.timers.setTimeout(() => {
          deadlineExpired = true;
          reject(deadlineError());
        }, this.reapTimeoutMs);
      });

      let processCleanupError: PiAdapterError | undefined;
      try {
        await Promise.race([
          this.terminateProcessGroupWithinDeadline(
            state,
            () => deadlineExpired,
            deadlineError,
          ),
          deadline,
        ]);
      } catch (error) {
        processCleanupError = safeError(
          error,
          "PI_RPC_PROCESS_EXIT",
          "Pi process cleanup failed",
        );
      } finally {
        this.timers.clearTimeout(deadlineTimer);
      }

      let configCleanupError: PiAdapterError | undefined;
      if (!state.configRemoved) {
        state.configRemoved = true;
        try {
          await this.removeConfigDir(state.configDir);
        } catch (error) {
          configCleanupError = safeError(
            error,
            "PI_RPC_CONFIG_ERROR",
            "Pi config cleanup failed",
          );
        }
      }

      if (processCleanupError) throw processCleanupError;
      if (configCleanupError) throw configCleanupError;
    })();
    return state.cleanupPromise;
  }

  private async terminateProcessGroupWithinDeadline(
    state: PiSessionState,
    deadlineExpired: () => boolean,
    deadlineError: () => PiAdapterError,
  ): Promise<void> {
    const pid = state.process.pid!;
    const leaderExitedBeforeTerm = state.exitObserved;
    const assertWithinDeadline = (): void => {
      if (deadlineExpired()) throw deadlineError();
    };

    const initiallyAlive = await this.isProcessGroupAlive(pid);
    assertWithinDeadline();
    if (!initiallyAlive) return;

    await this.sendProcessGroupSignal(pid, "SIGTERM");
    assertWithinDeadline();
    const aliveAfterTerm = await this.isProcessGroupAlive(pid);
    assertWithinDeadline();
    if (!aliveAfterTerm) return;

    if (leaderExitedBeforeTerm) {
      await this.delay(this.terminateGraceMs);
    } else {
      await this.waitForExit(state, this.terminateGraceMs);
    }
    assertWithinDeadline();
    const aliveAfterGrace = await this.isProcessGroupAlive(pid);
    assertWithinDeadline();
    if (!aliveAfterGrace) return;

    await this.sendProcessGroupSignal(pid, "SIGKILL");
    assertWithinDeadline();
    for (;;) {
      const alive = await this.isProcessGroupAlive(pid);
      assertWithinDeadline();
      if (!alive) return;
      await this.delay(this.processGroupPollIntervalMs);
      assertWithinDeadline();
    }
  }

  private async sendProcessGroupSignal(
    pid: number,
    signal: NodeJS.Signals,
  ): Promise<void> {
    try {
      await this.terminateProcessGroup(pid, signal);
    } catch (error) {
      if (
        !isRecord(error) ||
        (error.code !== "ESRCH" && error.code !== "EPERM")
      ) {
        throw error;
      }
      // ESRCH is already reaped. EPERM still means the group exists, so keep
      // probing/escalating until ESRCH or the authoritative cleanup deadline.
    }
  }

  private async isProcessGroupAlive(pid: number): Promise<boolean> {
    return await this.probeProcessGroup(pid);
  }

  private async delay(timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.timers.setTimeout(resolve, timeoutMs);
    });
  }

  private async waitForExit(
    state: PiSessionState,
    timeoutMs: number,
  ): Promise<boolean> {
    if (state.exitObserved) return true;
    let timer: unknown;
    const timedOut = new Promise<false>((resolve) => {
      timer = this.timers.setTimeout(() => resolve(false), timeoutMs);
    });
    const exited = state.processExited.promise.then(() => true as const);
    const result = await Promise.race([exited, timedOut]);
    if (result) this.timers.clearTimeout(timer);
    return result;
  }

  private async waitBounded(
    promise: Promise<boolean>,
    timeoutMs: number,
  ): Promise<boolean> {
    let timer: unknown;
    const timedOut = new Promise<false>((resolve) => {
      timer = this.timers.setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([promise, timedOut]);
    this.timers.clearTimeout(timer);
    return result;
  }

  private emit(event: SSEEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private emitCanonical(event: CanonicalEvent): void {
    for (const listener of this.canonicalListeners) listener(event);
  }

  private emitNative(event: NativeRuntimeEvent): void {
    for (const listener of this.nativeListeners) listener(event);
  }
}
