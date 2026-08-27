import { createHash } from "node:crypto";

export type PiUsageSnapshot = {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: Record<string, number>;
};

export type PiAvailableUsageSummary = {
  status?: never;
  reason?: never;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  totalCostUsd?: number;
  costDetail?: Record<string, number>;
};

export type PiTerminalUsageSummary =
  | PiAvailableUsageSummary
  | { status: "unavailable"; reason: "not_reported" };

export type PiObservedSelection = {
  codingAgent: "pi";
  aiProvider: string;
  model: string;
  reasoningLevel?: string;
};

export type PiMappingContext = {
  streamingUsage?: PiUsageSnapshot;
  finalMessageUsage?: PiUsageSnapshot;
  finalMessageIdentities: Set<string>;
  activeTools: Map<string, { toolName: string }>;
  failed: boolean;
  aborted: boolean;
  finalized: boolean;
};

export type PiShimEvent = {
  type: string;
  properties: Record<string, unknown>;
};

export type PiCanonicalEvent = {
  kind: string;
  [key: string]: unknown;
};

export type PiMappingResult = {
  events: PiShimEvent[];
  canonicalEvents: PiCanonicalEvent[];
  settlement?: boolean;
  terminal?: boolean;
  failureCode?: "PI_RPC_AUTH_ERROR";
};

export type PiMappingOptions = Readonly<{
  trustedFixedEndpointProvider?: "zai";
}>;

export class PiEventProtocolError extends Error {
  public readonly code = "PI_RPC_PROTOCOL_ERROR";

  constructor(safeDetail: string) {
    super(`PI_RPC_PROTOCOL_ERROR: ${safeDetail}`);
    this.name = "PiEventProtocolError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const finiteNonNegative = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const PI_DIAGNOSTIC_LIMITS = Object.freeze({
  maxDepth: 8,
  maxNodes: 512,
  maxArrayLength: 64,
  maxObjectKeys: 64,
  maxStringBytes: 8_192,
  maxEncodedBytes: 32_768,
  maxIdentitySourceBytes: 4_096,
});

const PI_TEXT_ENCODER = new TextEncoder();
const PI_SAFE_ID_PATTERN = /^rti_sha256_[a-f0-9]{64}$/u;
const PI_PRIVATE_ERROR_MAX_BYTES = 128;
const PI_PRIVATE_ERROR_MAX_OCCURRENCES = 8;
const PI_PRIVATE_ERROR_MAX_AGGREGATE_BYTES = 512;
const PI_PRIVATE_ERROR_MAX_STATUS_TOKENS = 4;
const PI_STANDALONE_HTTP_STATUS_PATTERN =
  /(?<![A-Za-z0-9_])[0-9]{3}(?![A-Za-z0-9_])/gu;

type PiPrivateAuthDiagnosticState = {
  occurrences: number;
  aggregateBytes: number;
  eligible: boolean;
};

// Private diagnostics are intentionally reduced to ephemeral bounds and
// eligibility state outside the mapping context, so their content cannot cross
// an emitted or serialized surface.
const PI_PRIVATE_AUTH_DIAGNOSTICS = new WeakMap<
  PiMappingContext,
  PiPrivateAuthDiagnosticState
>();
const PI_SENSITIVE_KEYS = new Set([
  "command",
  "commands",
  "cmd",
  "arg",
  "args",
  "argument",
  "arguments",
  "result",
  "results",
  "stdout",
  "stderr",
  "config",
  "configuration",
  "settings",
  "header",
  "headers",
  "authorization",
  "auth",
  "cookie",
  "cookies",
  "setcookie",
  "url",
  "urls",
  "uri",
  "uris",
  "query",
  "querystring",
  "userinfo",
  "env",
  "environment",
  "log",
  "logs",
  "logblob",
  "token",
  "tokens",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "secret",
  "secrets",
  "password",
  "passwd",
  "passphrase",
  "apikey",
  "key",
  "keys",
  "privatekey",
  "credential",
  "credentials",
]);

type PiDiagnosticErrorCode =
  | "PI_DIAGNOSTIC_MALFORMED"
  | "PI_DIAGNOSTIC_UNSUPPORTED"
  | "PI_DIAGNOSTIC_NON_PLAIN_OBJECT"
  | "PI_DIAGNOSTIC_CYCLE"
  | "PI_DIAGNOSTIC_TOO_DEEP"
  | "PI_DIAGNOSTIC_TOO_MANY_NODES"
  | "PI_DIAGNOSTIC_ARRAY_TOO_LARGE"
  | "PI_DIAGNOSTIC_OBJECT_TOO_LARGE"
  | "PI_DIAGNOSTIC_STRING_TOO_LARGE"
  | "PI_DIAGNOSTIC_ENCODED_TOO_LARGE";

class PiDiagnosticSanitizationError extends Error {
  public readonly code: PiDiagnosticErrorCode;

  public constructor(code: PiDiagnosticErrorCode) {
    super(`Pi diagnostic rejected: ${code}`);
    this.name = "PiDiagnosticSanitizationError";
    this.code = code;
  }
}

const redactDiagnosticString = (value: string): string =>
  value
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
      "[redacted-key]",
    )
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|passphrase|secret|credential|private[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "[redacted-credential]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/giu, "[redacted-token]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/giu, "[redacted-token]")
    .replace(
      /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[baprs])[-_][A-Za-z0-9._-]{8,}/giu,
      "[redacted-token]",
    )
    .replace(/\bAIza[A-Za-z0-9_-]{16,}/gu, "[redacted-token]")
    .replace(/\bAKIA[A-Z0-9]{12,}/gu, "[redacted-token]")
    .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/gu, "[redacted-token]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/giu, "[redacted-url]");

const normalizeDiagnosticKey = (key: string): string =>
  key.toLowerCase().replace(/[^a-z0-9]/gu, "");

const piSafeIdentity = (value: string): string => {
  if (PI_SAFE_ID_PATTERN.test(value)) return value;
  const source = PI_TEXT_ENCODER.encode(value);
  if (source.byteLength === 0 || source.byteLength > PI_DIAGNOSTIC_LIMITS.maxIdentitySourceBytes) {
    throw new PiEventProtocolError("identity source is outside the accepted bounds");
  }
  const digest = createHash("sha256")
    .update("almirant-runtime-identity-v1\0", "utf8")
    .update(source)
    .digest("hex");
  return `rti_sha256_${digest}`;
};

const sanitizePiDiagnostic = (root: unknown): unknown => {
  const ancestors = new Set<object>();
  let nodes = 0;
  let encodedBytes = 0;

  const addBytes = (bytes: number): void => {
    encodedBytes += bytes;
    if (encodedBytes > PI_DIAGNOSTIC_LIMITS.maxEncodedBytes) {
      throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_ENCODED_TOO_LARGE");
    }
  };
  const jsonStringBytes = (value: string): number =>
    PI_TEXT_ENCODER.encode(JSON.stringify(value)).byteLength;

  const visit = (value: unknown, depth: number, redactWhole: boolean): unknown => {
    if (depth > PI_DIAGNOSTIC_LIMITS.maxDepth) {
      throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_TOO_DEEP");
    }
    nodes += 1;
    if (nodes > PI_DIAGNOSTIC_LIMITS.maxNodes) {
      throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_TOO_MANY_NODES");
    }

    if (typeof value === "string") {
      if (PI_TEXT_ENCODER.encode(value).byteLength > PI_DIAGNOSTIC_LIMITS.maxStringBytes) {
        throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_STRING_TOO_LARGE");
      }
      addBytes(jsonStringBytes(value));
      return redactWhole ? "[redacted]" : redactDiagnosticString(value);
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_UNSUPPORTED");
      }
      addBytes(PI_TEXT_ENCODER.encode(String(value)).byteLength);
      return redactWhole ? "[redacted]" : value;
    }
    if (typeof value === "boolean") {
      addBytes(value ? 4 : 5);
      return redactWhole ? "[redacted]" : value;
    }
    if (value === null) {
      addBytes(4);
      return redactWhole ? "[redacted]" : null;
    }
    if (typeof value !== "object") {
      throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_UNSUPPORTED");
    }
    if (ancestors.has(value)) {
      throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_CYCLE");
    }
    ancestors.add(value);

    try {
      if (Array.isArray(value)) {
        if (value.length > PI_DIAGNOSTIC_LIMITS.maxArrayLength) {
          throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_ARRAY_TOO_LARGE");
        }
        const keys = Reflect.ownKeys(value);
        if (keys.length !== value.length + 1 || !keys.includes("length")) {
          throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_MALFORMED");
        }
        addBytes(2 + Math.max(0, value.length - 1));
        const output: unknown[] = [];
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_MALFORMED");
          }
          output.push(visit(descriptor.value, depth + 1, redactWhole));
        }
        return redactWhole ? "[redacted]" : output;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_NON_PLAIN_OBJECT");
      }
      const keys = Reflect.ownKeys(value);
      if (keys.length > PI_DIAGNOSTIC_LIMITS.maxObjectKeys) {
        throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_OBJECT_TOO_LARGE");
      }
      addBytes(2 + Math.max(0, keys.length - 1));
      const output: Record<string, unknown> = {};
      for (const [index, key] of keys.entries()) {
        if (typeof key !== "string") {
          throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_MALFORMED");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_MALFORMED");
        }
        addBytes(jsonStringBytes(key) + 1);
        const contentSafeKey = redactDiagnosticString(key) === key &&
          !["__proto__", "prototype", "constructor"].includes(key)
          ? key
          : `[redacted-key-${index}]`;
        output[contentSafeKey] = visit(
          descriptor.value,
          depth + 1,
          redactWhole || PI_SENSITIVE_KEYS.has(normalizeDiagnosticKey(key)),
        );
      }
      return redactWhole ? "[redacted]" : output;
    } finally {
      ancestors.delete(value);
    }
  };

  try {
    const sanitized = visit(root, 0, false);
    if (
      PI_TEXT_ENCODER.encode(JSON.stringify(sanitized)).byteLength >
      PI_DIAGNOSTIC_LIMITS.maxEncodedBytes
    ) {
      throw new PiDiagnosticSanitizationError(
        "PI_DIAGNOSTIC_ENCODED_TOO_LARGE",
      );
    }
    return sanitized;
  } catch (error) {
    if (error instanceof PiDiagnosticSanitizationError) throw error;
    throw new PiDiagnosticSanitizationError("PI_DIAGNOSTIC_MALFORMED");
  }
};

const normalizeToolName = (toolName: string): string => {
  const aliases: Record<string, string> = {
    bash: "Bash",
    edit: "Edit",
    glob: "Glob",
    grep: "Grep",
    read: "Read",
    write: "Write",
  };
  return aliases[toolName.toLowerCase()] ?? toolName;
};

const usageFrom = (value: unknown): PiUsageSnapshot | undefined => {
  if (!isRecord(value)) return undefined;
  const usage: PiUsageSnapshot = {};
  for (const key of ["input", "output", "reasoning", "cacheRead", "cacheWrite", "totalTokens"] as const) {
    const metric = finiteNonNegative(value[key]);
    if (metric !== undefined) usage[key] = metric;
  }
  if (isRecord(value.cost)) {
    const cost: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value.cost)) {
      const metric = finiteNonNegative(raw);
      if (metric !== undefined) cost[key] = metric;
    }
    if (Object.keys(cost).length > 0) usage.cost = cost;
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
};

const SUMMABLE_USAGE_KEYS = [
  "input",
  "output",
  "reasoning",
  "cacheRead",
  "cacheWrite",
  "totalTokens",
] as const;

const accumulateFinalUsage = (
  aggregate: PiUsageSnapshot | undefined,
  usage: PiUsageSnapshot,
): PiUsageSnapshot => {
  const result: PiUsageSnapshot = aggregate ? { ...aggregate } : {};
  for (const key of SUMMABLE_USAGE_KEYS) {
    const value = usage[key];
    if (value !== undefined) result[key] = (result[key] ?? 0) + value;
  }
  if (usage.cost) {
    const cost = { ...(result.cost ?? {}) };
    for (const [key, value] of Object.entries(usage.cost)) {
      cost[key] = (cost[key] ?? 0) + value;
    }
    result.cost = cost;
  }
  return result;
};

const stableIdentityValue = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.length > 0) {
    return PI_TEXT_ENCODER.encode(value).byteLength <=
      PI_DIAGNOSTIC_LIMITS.maxIdentitySourceBytes
      ? value
      : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
};

const finalMessageIdentity = (
  event: Record<string, unknown>,
  message: Record<string, unknown>,
  usage: PiUsageSnapshot,
): string => {
  for (const [kind, value] of [
    ["message", message.id],
    ["message", event.messageId],
    ["event", event.eventId],
    ["event", event.id],
  ] as const) {
    const identity = stableIdentityValue(value);
    if (identity) return piSafeIdentity(`${kind}:${identity}`);
  }

  const timestamp = stableIdentityValue(message.timestamp) ?? stableIdentityValue(event.timestamp);
  if (timestamp) {
    return piSafeIdentity(
      `timestamp:${nonEmptyString(message.role) ?? "unknown"}:${timestamp}`,
    );
  }

  const tokenIdentity = SUMMABLE_USAGE_KEYS
    .map((key) => `${key}=${usage[key] ?? ""}`)
    .join("|");
  const costIdentity = Object.entries(usage.cost ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
  return piSafeIdentity([
    "usage",
    nonEmptyString(message.role) ?? "unknown",
    nonEmptyString(message.stopReason) ?? "unknown",
    tokenIdentity,
    costIdentity,
  ].join(":"));
};

export const createPiMappingContext = (): PiMappingContext => ({
  finalMessageIdentities: new Set(),
  activeTools: new Map(),
  failed: false,
  aborted: false,
  finalized: false,
});

const textDelta = (
  sessionId: string,
  contentType: "text" | "thinking",
  delta: string,
): PiMappingResult => ({
  events: [{
    type: "message.part.delta",
    properties: { sessionId, delta, contentType },
  }],
  canonicalEvents: [{
    kind: contentType === "text" ? "agent.text" : "agent.thinking",
    content: delta,
  }],
});

const textComplete = (
  sessionId: string,
  contentType: "text" | "thinking",
  content: string,
): PiMappingResult => ({
  events: [{
    type: "message.part.updated",
    properties: { sessionId, contentType, part: { text: content } },
  }],
  canonicalEvents: contentType === "text"
    ? [{ kind: "agent.text.complete", fullText: content }]
    : [],
});

const toolSpecificEvents = (
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown> | undefined,
): PiCanonicalEvent[] => {
  if (!args) return [];
  const path = nonEmptyString(args.path) ?? nonEmptyString(args.filePath) ?? nonEmptyString(args.file_path);
  if (["Read", "Glob", "Grep"].includes(toolName) && path) {
    return [{ kind: "agent.file.read", toolCallId, filePath: path }];
  }
  if (toolName === "Write" && path) {
    return [{ kind: "agent.file.write", toolCallId, filePath: path }];
  }
  if (toolName === "Edit" && path) {
    return [{ kind: "agent.file.edit", toolCallId, filePath: path }];
  }
  if (toolName === "Bash") {
    return [{ kind: "agent.bash.execute", toolCallId, command: "[redacted]" }];
  }
  return [];
};

const requiredToolId = (event: Record<string, unknown>): string => {
  const id = nonEmptyString(event.toolCallId);
  if (!id) throw new PiEventProtocolError("tool event is missing toolCallId");
  return id;
};

const mapToolStart = (
  sessionId: string,
  event: Record<string, unknown>,
  context: PiMappingContext,
): PiMappingResult => {
  const toolCallId = requiredToolId(event);
  const emittedToolCallId = piSafeIdentity(`tool:${toolCallId}`);
  if (context.activeTools.has(toolCallId)) {
    throw new PiEventProtocolError("duplicate active toolCallId");
  }
  const rawToolName = nonEmptyString(event.toolName) ?? "unknown";
  const toolName = normalizeToolName(rawToolName);
  const args = isRecord(event.arguments)
    ? event.arguments
    : isRecord(event.args)
      ? event.args
      : undefined;
  context.activeTools.set(toolCallId, { toolName });
  return {
    events: [{
      type: "message.part.updated",
      properties: { sessionId, contentType: "tool_use", part: { text: `${toolName} started` } },
    }],
    canonicalEvents: [
      { kind: "agent.tool_call.start", toolName, toolCallId: emittedToolCallId },
      ...toolSpecificEvents(toolName, emittedToolCallId, args),
    ],
  };
};

const mapToolUpdate = (
  sessionId: string,
  event: Record<string, unknown>,
  context: PiMappingContext,
): PiMappingResult => {
  const toolCallId = requiredToolId(event);
  const active = context.activeTools.get(toolCallId);
  if (!active) throw new PiEventProtocolError("tool update references an inactive toolCallId");
  return {
    events: [{
      type: "message.part.updated",
      properties: {
        sessionId,
        contentType: "tool_use",
        part: { text: `${active.toolName} updated` },
      },
    }],
    canonicalEvents: [],
  };
};

const mapToolEnd = (
  sessionId: string,
  event: Record<string, unknown>,
  context: PiMappingContext,
): PiMappingResult => {
  const toolCallId = requiredToolId(event);
  const active = context.activeTools.get(toolCallId);
  if (!active) throw new PiEventProtocolError("tool end references an inactive toolCallId");
  const emittedToolCallId = piSafeIdentity(`tool:${toolCallId}`);
  context.activeTools.delete(toolCallId);
  const success = event.success === true || event.isError === false;
  return {
    events: [{
      type: "message.part.updated",
      properties: {
        sessionId,
        contentType: "tool_use",
        part: { text: `${active.toolName} ${success ? "completed" : "failed"}` },
      },
    }],
    canonicalEvents: [{
      kind: "agent.tool_call.result",
      toolCallId: emittedToolCallId,
      toolName: active.toolName,
      success,
      outputPreview: success ? "completed" : "failed",
    }],
  };
};

const privateDiagnosticMessages = (
  eventType: string,
  event: Record<string, unknown>,
): Record<string, unknown>[] => {
  if (
    eventType === "message_start" ||
    eventType === "message_end" ||
    eventType === "turn_end"
  ) {
    return isRecord(event.message) ? [event.message] : [];
  }
  if (eventType === "agent_end" && Array.isArray(event.messages)) {
    return event.messages.filter(isRecord);
  }
  return [];
};

const observePrivatePiAuthDiagnostics = (
  eventType: string,
  event: Record<string, unknown>,
  context: PiMappingContext,
  options: PiMappingOptions,
): void => {
  for (const message of privateDiagnosticMessages(eventType, event)) {
    if (message.stopReason === "error") context.failed = true;
    if (!Object.hasOwn(message, "errorMessage")) continue;

    const state = PI_PRIVATE_AUTH_DIAGNOSTICS.get(context) ?? {
      occurrences: 0,
      aggregateBytes: 0,
      eligible: true,
    };
    PI_PRIVATE_AUTH_DIAGNOSTICS.set(context, state);
    state.occurrences += 1;

    const privateMessage = message.errorMessage;
    if (typeof privateMessage !== "string") {
      state.eligible = false;
      continue;
    }

    const encoded = PI_TEXT_ENCODER.encode(privateMessage);
    state.aggregateBytes += encoded.byteLength;
    if (
      options.trustedFixedEndpointProvider !== "zai" ||
      message.stopReason !== "error" ||
      state.occurrences > PI_PRIVATE_ERROR_MAX_OCCURRENCES ||
      encoded.byteLength < 1 ||
      encoded.byteLength > PI_PRIVATE_ERROR_MAX_BYTES ||
      state.aggregateBytes > PI_PRIVATE_ERROR_MAX_AGGREGATE_BYTES
    ) {
      state.eligible = false;
      continue;
    }

    if (!state.eligible) continue;

    const statuses = privateMessage.match(PI_STANDALONE_HTTP_STATUS_PATTERN);
    if (
      !statuses ||
      statuses.length < 1 ||
      statuses.length > PI_PRIVATE_ERROR_MAX_STATUS_TOKENS ||
      statuses.some((status) => status !== "401" && status !== "403")
    ) {
      state.eligible = false;
    }
  }
};

const consumePrivatePiAuthFailure = (
  context: PiMappingContext,
): "PI_RPC_AUTH_ERROR" | undefined => {
  const state = PI_PRIVATE_AUTH_DIAGNOSTICS.get(context);
  PI_PRIVATE_AUTH_DIAGNOSTICS.delete(context);
  return state?.eligible === true && state.occurrences > 0
    ? "PI_RPC_AUTH_ERROR"
    : undefined;
};

const mapPiEventToShimUnsafe = (
  sessionId: string,
  event: Record<string, unknown>,
  context: PiMappingContext,
  options: PiMappingOptions,
): PiMappingResult => {
  const eventType = nonEmptyString(event.type);
  if (!eventType) throw new PiEventProtocolError("event is missing type");
  observePrivatePiAuthDiagnostics(eventType, event, context, options);

  if (eventType === "message_update") {
    const usage = usageFrom(event.usage);
    if (usage) context.streamingUsage = usage;
    const assistantEvent = isRecord(event.assistantMessageEvent)
      ? event.assistantMessageEvent
      : undefined;
    const nestedType = nonEmptyString(assistantEvent?.type);
    const delta = nonEmptyString(assistantEvent?.delta);
    if (nestedType === "text_delta" && delta) return textDelta(sessionId, "text", delta);
    if (nestedType === "thinking_delta" && delta) return textDelta(sessionId, "thinking", delta);
    return { events: [], canonicalEvents: [] };
  }

  if (eventType === "text_update" || eventType === "thinking_update") {
    const delta = nonEmptyString(event.delta);
    return delta
      ? textDelta(sessionId, eventType === "text_update" ? "text" : "thinking", delta)
      : { events: [], canonicalEvents: [] };
  }
  if (eventType === "text_end" || eventType === "thinking_end") {
    const content = nonEmptyString(event.content);
    return content
      ? textComplete(sessionId, eventType === "text_end" ? "text" : "thinking", content)
      : { events: [], canonicalEvents: [] };
  }
  if (eventType === "text_start" || eventType === "thinking_start") {
    return { events: [], canonicalEvents: [] };
  }

  if (eventType === "tool_start" || eventType === "tool_execution_start") {
    return mapToolStart(sessionId, event, context);
  }
  if (eventType === "tool_update" || eventType === "tool_execution_update") {
    return mapToolUpdate(sessionId, event, context);
  }
  if (eventType === "tool_end" || eventType === "tool_execution_end") {
    return mapToolEnd(sessionId, event, context);
  }

  if (eventType === "message_end") {
    const message = isRecord(event.message) ? event.message : undefined;
    const finalUsage = usageFrom(message?.usage);
    if (message && finalUsage) {
      const identity = finalMessageIdentity(event, message, finalUsage);
      if (!context.finalMessageIdentities.has(identity)) {
        if (context.finalized) {
          throw new PiEventProtocolError("new message_end arrived after turn finalization");
        }
        context.finalMessageIdentities.add(identity);
        context.finalMessageUsage = accumulateFinalUsage(
          context.finalMessageUsage,
          finalUsage,
        );
      }
    }
    const stopReason = nonEmptyString(message?.stopReason);
    if (stopReason === "error") context.failed = true;
    if (stopReason === "aborted") context.aborted = true;
    return { events: [], canonicalEvents: [] };
  }

  if (eventType === "turn_end") {
    const message = isRecord(event.message) ? event.message : undefined;
    const stopReason = nonEmptyString(message?.stopReason) ??
      nonEmptyString(event.stopReason);
    if (stopReason === "error") context.failed = true;
    if (stopReason === "aborted") context.aborted = true;
    return { events: [], canonicalEvents: [] };
  }

  if (eventType === "extension_error" || (eventType === "auto_retry_end" && event.success === false)) {
    context.failed = true;
    return {
      events: [{
        type: "session.status",
        properties: { sessionId, status: "error", message: "Pi runtime reported an error" },
      }],
      canonicalEvents: [{
        kind: "session.error",
        message: "Pi runtime reported an error",
        recoverable: false,
        errorCode: "PI_RPC_AGENT_ERROR",
        errorCategory: "agent",
      }],
    };
  }

  if (eventType === "agent_settled") {
    const failureCode = consumePrivatePiAuthFailure(context);
    return {
      events: [],
      canonicalEvents: [],
      settlement: true,
      ...(failureCode ? { failureCode } : {}),
    };
  }

  return { events: [], canonicalEvents: [] };
};

const sanitizePiMappingResult = (
  sessionId: string,
  context: PiMappingContext,
  result: PiMappingResult,
): PiMappingResult => {
  try {
    return sanitizePiDiagnostic(result) as PiMappingResult;
  } catch {
    context.failed = true;
    const safeSessionId = sessionId.length <= 256 &&
      redactDiagnosticString(sessionId) === sessionId
      ? sessionId
      : "[redacted]";
    return {
      events: [{
        type: "session.status",
        properties: {
          sessionId: safeSessionId,
          status: "error",
          message: "Pi runtime diagnostic was rejected",
        },
      }],
      canonicalEvents: [{
        kind: "session.error",
        message: "Pi runtime diagnostic was rejected",
        recoverable: false,
        errorCode: "PI_RPC_DIAGNOSTIC_REJECTED",
        errorCategory: "agent",
      }],
    };
  }
};

export const mapPiEventToShim = (
  sessionId: string,
  event: Record<string, unknown>,
  context: PiMappingContext,
  options: PiMappingOptions = {},
): PiMappingResult =>
  sanitizePiMappingResult(
    sessionId,
    context,
    mapPiEventToShimUnsafe(sessionId, event, context, options),
  );

const VERIFIED_AGGREGATE_KEYS = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "totalTokens",
] as const;

const isVerifiedAggregate = (
  usage: PiUsageSnapshot | undefined,
): usage is PiUsageSnapshot =>
  usage !== undefined && VERIFIED_AGGREGATE_KEYS.every(
    (key) => typeof usage[key] === "number" && Number.isFinite(usage[key]) && usage[key]! >= 0,
  );

type PiTerminalUsageResolution = {
  summary: PiTerminalUsageSummary;
  evidence: Record<string, unknown>;
};

const usageSummary = (
  stats: PiUsageSnapshot | undefined,
  finalMessage: PiUsageSnapshot | undefined,
  finalMessageIdentities: ReadonlySet<string>,
): PiTerminalUsageResolution => {
  const source = isVerifiedAggregate(stats)
    ? "terminal_aggregate"
    : isVerifiedAggregate(finalMessage)
      ? "final_messages"
      : undefined;
  const primary = source === "terminal_aggregate"
    ? stats
    : source === "final_messages"
      ? finalMessage
      : undefined;
  if (!primary || !source) {
    const unavailable = { status: "unavailable", reason: "not_reported" } as const;
    return { summary: unavailable, evidence: unavailable };
  }

  const summary: PiAvailableUsageSummary = {
    inputTokens: primary.input!,
    outputTokens: primary.output!,
    cacheReadTokens: primary.cacheRead!,
    cacheCreationTokens: primary.cacheWrite!,
    totalTokens: primary.totalTokens!,
  };
  if (finalMessage?.reasoning !== undefined) summary.reasoningTokens = finalMessage.reasoning;
  if (finalMessage?.cost) {
    summary.costDetail = { ...finalMessage.cost };
    if (finalMessage.cost.total !== undefined) summary.totalCostUsd = finalMessage.cost.total;
  }

  const evidence: Record<string, unknown> = {
    status: "reported",
    source,
    ...(finalMessageIdentities.size > 0
      ? {
          identities: [...finalMessageIdentities].map((messageId) => ({
            messageId,
          })),
        }
      : {}),
    inputTokens: primary.input!,
    outputTokens: primary.output!,
    cacheReadTokens: primary.cacheRead!,
    cacheWriteTokens: primary.cacheWrite!,
    ...(finalMessage?.reasoning !== undefined
      ? { reasoningTokens: finalMessage.reasoning }
      : {}),
    totalTokens: primary.totalTokens!,
    ...(finalMessage?.cost
      ? {
          cost: {
            ...(finalMessage.cost.total !== undefined
              ? { totalUsd: finalMessage.cost.total }
              : {}),
            detail: { ...finalMessage.cost },
          },
        }
      : {}),
  };
  return { summary, evidence };
};

const SAFE_PI_FAILURE_CODES = new Set([
  "PI_RPC_AUTH_ERROR",
  "PI_RPC_CONFIG_ERROR",
  "PI_RPC_STATE_MISMATCH",
  "PI_RPC_PROTOCOL_ERROR",
  "PI_RPC_PROCESS_EXIT",
  "PI_RPC_PROCESS_SIGNAL",
  "PI_RPC_STDIN_ERROR",
  "PI_RPC_TIMEOUT",
  "PI_RPC_CANCELLED",
  "PI_RPC_COMMAND_FAILED",
  "PI_RPC_PROCESS_REAP_TIMEOUT",
  "PI_RPC_AGENT_ERROR",
  "PI_RPC_RUNTIME_ERROR",
]);

const finalizePiTurnUnsafe = (
  sessionId: string,
  context: PiMappingContext,
  options: {
    sessionStatsDelta?: PiUsageSnapshot;
    observedSelection?: PiObservedSelection;
    failureCode?: string;
    failureMessage?: string;
  } = {},
): PiMappingResult => {
  PI_PRIVATE_AUTH_DIAGNOSTICS.delete(context);
  if (context.finalized) {
    return { events: [], canonicalEvents: [], terminal: true };
  }
  context.finalized = true;

  const canonicalEvents: PiCanonicalEvent[] = [];
  for (const [toolCallId, active] of context.activeTools) {
    canonicalEvents.push({
      kind: "agent.tool_call.result",
      toolCallId: piSafeIdentity(`tool:${toolCallId}`),
      toolName: active.toolName,
      success: false,
      outputPreview: context.failed ? "failed" : "interrupted",
    });
  }
  context.activeTools.clear();

  const requestedFailureCode = options.failureCode ??
    (context.failed ? "PI_RPC_AGENT_ERROR" : undefined);
  const failureCode = requestedFailureCode &&
    SAFE_PI_FAILURE_CODES.has(requestedFailureCode)
    ? requestedFailureCode
    : requestedFailureCode
      ? "PI_RPC_RUNTIME_ERROR"
      : undefined;
  const failureMessage = context.aborted ? "Pi turn aborted" : "Pi turn failed";
  const events: PiShimEvent[] = [];
  if (failureCode) {
    events.push({
      type: "session.status",
      properties: { sessionId, status: "error", message: failureMessage },
    });
    canonicalEvents.push({
      kind: "session.error",
      message: failureMessage,
      recoverable: false,
      errorCode: failureCode,
      errorCategory: "infra",
    });
  }

  events.push({ type: "session.idle", properties: { sessionId } });
  const terminalUsage = usageSummary(
    options.sessionStatsDelta,
    context.finalMessageUsage,
    context.finalMessageIdentities,
  );
  canonicalEvents.push({
    kind: "session.idle",
    hasBackgroundAgents: false,
    isPlanningJob: false,
    metadata: {
      usageSummary: terminalUsage.summary,
      runtimeEvidence: {
        schemaVersion: "runtime-evidence-v1",
        usage: terminalUsage.evidence,
        ...(options.observedSelection
          ? { observed: { ...options.observedSelection } }
          : {}),
      },
    },
  });
  return { events, canonicalEvents, terminal: true };
};

export const finalizePiTurn = (
  sessionId: string,
  context: PiMappingContext,
  options: {
    sessionStatsDelta?: PiUsageSnapshot;
    observedSelection?: PiObservedSelection;
    failureCode?: string;
    failureMessage?: string;
  } = {},
): PiMappingResult =>
  sanitizePiMappingResult(
    sessionId,
    context,
    finalizePiTurnUnsafe(sessionId, context, options),
  );

const USAGE_KEYS = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const;

export const computeSessionStatsDelta = (
  current: PiUsageSnapshot,
  baseline: PiUsageSnapshot,
): PiUsageSnapshot => {
  const delta: PiUsageSnapshot = {};
  for (const key of USAGE_KEYS) {
    const currentValue = current[key];
    const baselineValue = baseline[key];
    if (currentValue === undefined) continue;
    const difference = currentValue - (baselineValue ?? 0);
    if (!Number.isFinite(difference) || difference < 0) {
      throw new PiEventProtocolError("session statistics regressed below the pre-turn baseline");
    }
    delta[key] = difference;
  }
  return delta;
};

const NATIVE_EVENT_TYPES = new Set([
  "agent_start",
  "turn_start",
  "message_start",
  "message_update",
  "thinking_start",
  "thinking_update",
  "thinking_end",
  "text_start",
  "text_update",
  "text_end",
  "tool_start",
  "tool_update",
  "tool_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "message_end",
  "turn_end",
  "agent_end",
  "agent_settled",
  "extension_error",
  "auto_retry_start",
  "auto_retry_end",
]);

const sanitizeUsage = (value: unknown, depth: number): Record<string, unknown> | undefined => {
  if (!isRecord(value) || depth > 4) return undefined;
  const safe: Record<string, unknown> = {};
  for (const key of ["input", "output", "reasoning", "cacheRead", "cacheWrite", "totalTokens", "total"] as const) {
    const metric = finiteNonNegative(value[key]);
    if (metric !== undefined) safe[key] = metric;
  }
  if (isRecord(value.cost)) {
    const cost: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value.cost)) {
      const metric = finiteNonNegative(raw);
      if (metric !== undefined) cost[key] = metric;
    }
    if (Object.keys(cost).length > 0) safe.cost = cost;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
};

export const projectPiNativeEvent = (
  event: Record<string, unknown>,
  maxBytes = 32_768,
): Record<string, unknown> | null => {
  const type = nonEmptyString(event.type);
  if (!type || !NATIVE_EVENT_TYPES.has(type)) return null;

  try {
    const projected: Record<string, unknown> = { type };
    const contentIndex = finiteNonNegative(event.contentIndex);
    if (contentIndex !== undefined) projected.contentIndex = contentIndex;
    const toolCallId = nonEmptyString(event.toolCallId);
    if (toolCallId) projected.toolCallId = piSafeIdentity(`tool:${toolCallId}`);
    for (const key of ["toolName", "role", "stopReason"] as const) {
      const value = nonEmptyString(event[key]);
      if (value) projected[key] = value;
    }
    for (const key of ["success", "isError"] as const) {
      if (typeof event[key] === "boolean") projected[key] = event[key];
    }
    const delta = nonEmptyString(event.delta);
    if (delta) projected.delta = delta;
    const usage = sanitizeUsage(event.usage, 1);
    if (usage) projected.usage = usage;

    const assistant = isRecord(event.assistantMessageEvent)
      ? event.assistantMessageEvent
      : undefined;
    if (assistant) {
      const assistantType = nonEmptyString(assistant.type);
      const assistantDelta = nonEmptyString(assistant.delta);
      projected.assistantMessageEvent = {
        ...(assistantType ? { type: assistantType } : {}),
        ...(assistantDelta ? { delta: assistantDelta } : {}),
      };
    }

    const message = isRecord(event.message) ? event.message : undefined;
    if (message) {
      const safeMessage: Record<string, unknown> = {};
      const role = nonEmptyString(message.role);
      const stopReason = nonEmptyString(message.stopReason);
      const messageUsage = sanitizeUsage(message.usage, 2);
      if (role) safeMessage.role = role;
      if (stopReason) safeMessage.stopReason = stopReason;
      if (messageUsage) safeMessage.usage = messageUsage;
      if (Object.keys(safeMessage).length > 0) projected.message = safeMessage;
    }

    const sanitized = sanitizePiDiagnostic(projected) as Record<string, unknown>;
    const effectiveMaxBytes = Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.min(maxBytes, PI_DIAGNOSTIC_LIMITS.maxEncodedBytes)
      : PI_DIAGNOSTIC_LIMITS.maxEncodedBytes;
    if (
      PI_TEXT_ENCODER.encode(JSON.stringify(sanitized)).byteLength >
      effectiveMaxBytes
    ) {
      throw new PiDiagnosticSanitizationError(
        "PI_DIAGNOSTIC_ENCODED_TOO_LARGE",
      );
    }
    return sanitized;
  } catch {
    return {
      type,
      diagnostic: { kind: "pi.native_projection_oversized", dropped: true },
    };
  }
};
