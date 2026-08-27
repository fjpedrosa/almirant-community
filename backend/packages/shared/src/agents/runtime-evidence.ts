import {
  isSafeRuntimeIdentity,
  type SafeRuntimeIdentity,
} from "./runtime-diagnostic-sanitizer";
import { RESOLVED_RUNTIME_SELECTION_SCHEMA_VERSION } from "./runtime-selection";

export const RUNTIME_EVIDENCE_SCHEMA_VERSION = "runtime-evidence-v1" as const;

export const RUNTIME_EVIDENCE_LIMITS = Object.freeze({
  maxBytes: 32_768,
  maxDepth: 8,
  maxNodes: 512,
  maxArrayLength: 64,
  maxObjectKeys: 64,
  maxTokenCount: 1_000_000_000_000,
  maxCostUsd: 1_000_000_000,
});

export type RuntimeEvidenceUsageSource =
  | "terminal_aggregate"
  | "final_messages";

export type RuntimeEvidenceUnavailableReason = "not_reported";

export type RuntimeUsageIdentity = Readonly<{
  eventId?: SafeRuntimeIdentity;
  turnId?: SafeRuntimeIdentity;
  messageId?: SafeRuntimeIdentity;
  contentKey?: SafeRuntimeIdentity;
}>;

export type RuntimeReportedUsageEvidence = Readonly<{
  status: "reported";
  source: RuntimeEvidenceUsageSource;
  identities?: readonly RuntimeUsageIdentity[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens: number;
  cost?: Readonly<{
    totalUsd?: number;
    detail?: Readonly<Record<string, number>>;
  }>;
}>;

export type RuntimeUnavailableUsageEvidence = Readonly<{
  status: "unavailable";
  reason: RuntimeEvidenceUnavailableReason;
}>;

/**
 * Requested and observed values are evidence, not executable capability types.
 * Keeping their dimensions as bounded strings permits read-open diagnostics
 * without turning an unknown future value into an admitted runtime tuple.
 */
export type RuntimeSelectionEvidenceSnapshot = Readonly<{
  codingAgent: string;
  aiProvider: string;
  model: string;
  authClass?: string;
  capabilities?: readonly string[];
  reasoningLevel?: string;
}>;

/**
 * A resolved lane contains only registry-admitted executable values. The legacy
 * `provider` member is deliberately omitted: infrastructure has its own lane.
 */
export type RuntimeResolvedSelectionEvidence = Readonly<{
  schemaVersion: typeof RESOLVED_RUNTIME_SELECTION_SCHEMA_VERSION;
  registryVersion: number;
  projectionHash: string;
  codingAgent: "claude-code" | "codex" | "opencode" | "pi";
  aiProvider: "anthropic" | "openai" | "google" | "zai" | "xai";
  model: string;
  authClass:
    | "api_key"
    | "setup_token"
    | "provider_oauth"
    | "subscription";
  capabilities: readonly (
    | "mcp"
    | "browser"
    | "extensions"
    | "sandbox"
    | "permission_enforced"
    | "read_only_enforced"
  )[];
  provenance: Readonly<{
    provider: "explicit";
    codingAgent: "explicit";
    aiProvider: "explicit";
    model: "explicit";
    authClass: "explicit";
    capabilities: "explicit";
  }>;
}>;

export type RuntimeInfrastructureProvider =
  | "claude-code"
  | "codex"
  | "zipu"
  | "grok";

type RuntimeEvidenceBase = Readonly<{
  schemaVersion: typeof RUNTIME_EVIDENCE_SCHEMA_VERSION;
  requested?: RuntimeSelectionEvidenceSnapshot;
  resolved?: RuntimeResolvedSelectionEvidence;
  observed?: RuntimeSelectionEvidenceSnapshot;
  infrastructureProvider?: RuntimeInfrastructureProvider;
}>;

/** One versioned union for terminal usage plus separated runtime selections. */
export type RuntimeEvidence = RuntimeEvidenceBase &
  Readonly<{
    usage: RuntimeReportedUsageEvidence | RuntimeUnavailableUsageEvidence;
  }>;

export type RuntimeEvidenceValidationErrorCode =
  | "RUNTIME_EVIDENCE_MALFORMED"
  | "RUNTIME_EVIDENCE_TOO_DEEP"
  | "RUNTIME_EVIDENCE_TOO_LARGE"
  | "RUNTIME_EVIDENCE_NON_FINITE";

export class RuntimeEvidenceValidationError extends Error {
  public readonly code: RuntimeEvidenceValidationErrorCode;

  public constructor(code: RuntimeEvidenceValidationErrorCode) {
    super(`Runtime evidence rejected: ${code}`);
    this.name = "RuntimeEvidenceValidationError";
    this.code = code;
  }
}

type UnknownRecord = Record<string, unknown>;

const hasOwn = (value: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
};

const isBoundedString = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= 256;

const isOneOf = <const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] =>
  typeof value === "string" && values.some((entry) => entry === value);

const isBoundedStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= RUNTIME_EVIDENCE_LIMITS.maxArrayLength &&
  value.every(isBoundedString);

const isTokenCount = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= RUNTIME_EVIDENCE_LIMITS.maxTokenCount;

const isCostMetric = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= RUNTIME_EVIDENCE_LIMITS.maxCostUsd;

const isRuntimeUsageIdentity = (
  value: unknown,
): value is RuntimeUsageIdentity => {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [], ["eventId", "turnId", "messageId", "contentKey"])
  ) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => isSafeRuntimeIdentity(value[key]));
};

const isRuntimeCostEvidence = (
  value: unknown,
): value is NonNullable<RuntimeReportedUsageEvidence["cost"]> => {
  if (!isRecord(value) || !hasExactKeys(value, [], ["totalUsd", "detail"])) {
    return false;
  }
  const hasTotal = hasOwn(value, "totalUsd");
  const hasDetail = hasOwn(value, "detail");
  if (!hasTotal && !hasDetail) return false;
  if (hasTotal && !isCostMetric(value.totalUsd)) return false;
  if (hasDetail) {
    if (!isRecord(value.detail)) return false;
    if (
      !Object.entries(value.detail).every(
        ([key, metric]) => isBoundedString(key) && isCostMetric(metric),
      )
    ) {
      return false;
    }
    if (!hasTotal && Object.keys(value.detail).length === 0) return false;
  }
  return true;
};

const isRuntimeReportedUsageEvidence = (
  value: unknown,
): value is RuntimeReportedUsageEvidence => {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(
      value,
      ["status", "source", "inputTokens", "outputTokens", "totalTokens"],
      [
        "identities",
        "cacheReadTokens",
        "cacheWriteTokens",
        "reasoningTokens",
        "cost",
      ],
    )
  ) {
    return false;
  }
  if (
    value.status !== "reported" ||
    !isOneOf(value.source, ["terminal_aggregate", "final_messages"] as const) ||
    !isTokenCount(value.inputTokens) ||
    !isTokenCount(value.outputTokens) ||
    !isTokenCount(value.totalTokens)
  ) {
    return false;
  }
  for (const key of [
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningTokens",
  ] as const) {
    if (hasOwn(value, key) && !isTokenCount(value[key])) return false;
  }
  if (hasOwn(value, "identities")) {
    if (
      !Array.isArray(value.identities) ||
      value.identities.length > RUNTIME_EVIDENCE_LIMITS.maxArrayLength ||
      !value.identities.every(isRuntimeUsageIdentity)
    ) {
      return false;
    }
  }
  return !hasOwn(value, "cost") || isRuntimeCostEvidence(value.cost);
};

const isRuntimeUnavailableUsageEvidence = (
  value: unknown,
): value is RuntimeUnavailableUsageEvidence =>
  isRecord(value) &&
  hasExactKeys(value, ["status", "reason"]) &&
  value.status === "unavailable" &&
  value.reason === "not_reported";

const isRuntimeSelectionEvidenceSnapshot = (
  value: unknown,
): value is RuntimeSelectionEvidenceSnapshot => {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(
      value,
      ["codingAgent", "aiProvider", "model"],
      ["authClass", "capabilities", "reasoningLevel"],
    ) ||
    !isBoundedString(value.codingAgent) ||
    !isBoundedString(value.aiProvider) ||
    !isBoundedString(value.model)
  ) {
    return false;
  }
  if (hasOwn(value, "authClass") && !isBoundedString(value.authClass)) {
    return false;
  }
  if (hasOwn(value, "capabilities") && !isBoundedStringArray(value.capabilities)) {
    return false;
  }
  return !hasOwn(value, "reasoningLevel") || isBoundedString(value.reasoningLevel);
};

const isRuntimeResolvedSelectionEvidence = (
  value: unknown,
): value is RuntimeResolvedSelectionEvidence => {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "registryVersion",
      "projectionHash",
      "codingAgent",
      "aiProvider",
      "model",
      "authClass",
      "capabilities",
      "provenance",
    ]) ||
    value.schemaVersion !== RESOLVED_RUNTIME_SELECTION_SCHEMA_VERSION ||
    typeof value.registryVersion !== "number" ||
    !Number.isInteger(value.registryVersion) ||
    value.registryVersion <= 0 ||
    value.registryVersion > 1_000_000 ||
    !isBoundedString(value.projectionHash) ||
    !isOneOf(value.codingAgent, ["claude-code", "codex", "opencode", "pi"] as const) ||
    !isOneOf(value.aiProvider, ["anthropic", "openai", "google", "zai", "xai"] as const) ||
    !isBoundedString(value.model) ||
    !isOneOf(
      value.authClass,
      ["api_key", "setup_token", "provider_oauth", "subscription"] as const,
    ) ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > RUNTIME_EVIDENCE_LIMITS.maxArrayLength ||
    !value.capabilities.every((capability) =>
      isOneOf(
        capability,
        [
          "mcp",
          "browser",
          "extensions",
          "sandbox",
          "permission_enforced",
          "read_only_enforced",
        ] as const,
      ),
    )
  ) {
    return false;
  }
  if (
    !isRecord(value.provenance) ||
    !hasExactKeys(value.provenance, [
      "provider",
      "codingAgent",
      "aiProvider",
      "model",
      "authClass",
      "capabilities",
    ])
  ) {
    return false;
  }
  return Object.values(value.provenance).every((entry) => entry === "explicit");
};

const isRuntimeEvidence = (value: unknown): value is RuntimeEvidence => {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(
      value,
      ["schemaVersion", "usage"],
      ["requested", "resolved", "observed", "infrastructureProvider"],
    ) ||
    value.schemaVersion !== RUNTIME_EVIDENCE_SCHEMA_VERSION ||
    (!isRuntimeReportedUsageEvidence(value.usage) &&
      !isRuntimeUnavailableUsageEvidence(value.usage))
  ) {
    return false;
  }
  if (
    hasOwn(value, "requested") &&
    !isRuntimeSelectionEvidenceSnapshot(value.requested)
  ) {
    return false;
  }
  if (
    hasOwn(value, "resolved") &&
    !isRuntimeResolvedSelectionEvidence(value.resolved)
  ) {
    return false;
  }
  if (
    hasOwn(value, "observed") &&
    !isRuntimeSelectionEvidenceSnapshot(value.observed)
  ) {
    return false;
  }
  return !hasOwn(value, "infrastructureProvider") ||
    isOneOf(
      value.infrastructureProvider,
      ["claude-code", "codex", "zipu", "grok"] as const,
    );
};

const textEncoder = new TextEncoder();

const assertBoundedInput = (root: unknown): void => {
  const seen = new Set<object>();
  let nodes = 0;
  let bytes = 0;

  const addByteCount = (count: number): void => {
    bytes += count;
    if (bytes > RUNTIME_EVIDENCE_LIMITS.maxBytes) {
      throw new RuntimeEvidenceValidationError("RUNTIME_EVIDENCE_TOO_LARGE");
    }
  };

  const addJsonStringBytes = (value: string): void => {
    if (value.length > RUNTIME_EVIDENCE_LIMITS.maxBytes) {
      throw new RuntimeEvidenceValidationError("RUNTIME_EVIDENCE_TOO_LARGE");
    }
    addByteCount(textEncoder.encode(JSON.stringify(value)).byteLength);
  };

  const malformed = (): never => {
    throw new RuntimeEvidenceValidationError("RUNTIME_EVIDENCE_MALFORMED");
  };

  const visit = (value: unknown, depth: number): void => {
    if (depth > RUNTIME_EVIDENCE_LIMITS.maxDepth) {
      throw new RuntimeEvidenceValidationError("RUNTIME_EVIDENCE_TOO_DEEP");
    }
    nodes += 1;
    if (nodes > RUNTIME_EVIDENCE_LIMITS.maxNodes) {
      throw new RuntimeEvidenceValidationError("RUNTIME_EVIDENCE_TOO_LARGE");
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new RuntimeEvidenceValidationError("RUNTIME_EVIDENCE_NON_FINITE");
      }
      addByteCount(textEncoder.encode(String(value)).byteLength);
      return;
    }
    if (typeof value === "string") {
      addJsonStringBytes(value);
      return;
    }
    if (value === null) {
      addByteCount(4);
      return;
    }
    if (typeof value === "boolean") {
      addByteCount(value ? 4 : 5);
      return;
    }
    if (typeof value !== "object" || value === null) {
      throw new RuntimeEvidenceValidationError("RUNTIME_EVIDENCE_MALFORMED");
    }
    const objectValue: object = value;
    if (seen.has(objectValue)) malformed();
    seen.add(objectValue);

    if (Array.isArray(objectValue)) {
      if (objectValue.length > RUNTIME_EVIDENCE_LIMITS.maxArrayLength) {
        throw new RuntimeEvidenceValidationError("RUNTIME_EVIDENCE_TOO_LARGE");
      }
      const ownKeys = Reflect.ownKeys(objectValue);
      if (
        ownKeys.length !== objectValue.length + 1 ||
        !ownKeys.includes("length")
      ) {
        malformed();
      }
      addByteCount(2 + Math.max(0, objectValue.length - 1));
      for (let index = 0; index < objectValue.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          objectValue,
          String(index),
        );
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new RuntimeEvidenceValidationError(
            "RUNTIME_EVIDENCE_MALFORMED",
          );
        }
        visit(descriptor.value, depth + 1);
      }
      return;
    }

    const prototype = Object.getPrototypeOf(objectValue);
    if (prototype !== Object.prototype && prototype !== null) malformed();
    const ownKeys = Reflect.ownKeys(objectValue);
    if (ownKeys.length > RUNTIME_EVIDENCE_LIMITS.maxObjectKeys) {
      throw new RuntimeEvidenceValidationError("RUNTIME_EVIDENCE_TOO_LARGE");
    }
    addByteCount(2 + Math.max(0, ownKeys.length - 1) + ownKeys.length);
    for (const key of ownKeys) {
      if (typeof key !== "string") {
        throw new RuntimeEvidenceValidationError(
          "RUNTIME_EVIDENCE_MALFORMED",
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new RuntimeEvidenceValidationError(
          "RUNTIME_EVIDENCE_MALFORMED",
        );
      }
      addJsonStringBytes(key);
      visit(descriptor.value, depth + 1);
    }
  };

  visit(root, 0);
};

export type RuntimeEvidenceSafeParseResult =
  | { success: true; data: RuntimeEvidence }
  | { success: false; error: RuntimeEvidenceValidationError };

export const safeParseRuntimeEvidence = (
  value: unknown,
): RuntimeEvidenceSafeParseResult => {
  try {
    assertBoundedInput(value);
    if (!isRuntimeEvidence(value)) {
      return {
        success: false,
        error: new RuntimeEvidenceValidationError(
          "RUNTIME_EVIDENCE_MALFORMED",
        ),
      };
    }
    // Return a detached JSON-safe copy, matching the previous schema parser's
    // behavior without retaining mutable references across the trust boundary.
    const data = JSON.parse(JSON.stringify(value)) as RuntimeEvidence;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof RuntimeEvidenceValidationError
          ? error
          : new RuntimeEvidenceValidationError("RUNTIME_EVIDENCE_MALFORMED"),
    };
  }
};

export const parseRuntimeEvidence = (value: unknown): RuntimeEvidence => {
  const result = safeParseRuntimeEvidence(value);
  if (!result.success) throw result.error;
  return result.data;
};
