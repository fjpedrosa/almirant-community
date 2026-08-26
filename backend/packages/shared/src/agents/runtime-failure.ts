import type { RuntimeRejectionCode } from "./runtime-capability-registry";

export const RUNTIME_FAILURE_SCHEMA_VERSION = "runtime-failure-v1" as const;
export const RUNTIME_FAILURE_SAFE_MESSAGE_MAX_LENGTH = 96 as const;

export const runtimeFailureCategories = Object.freeze([
  "auth",
  "model",
  "endpoint",
  "protocol",
  "process",
  "cancellation",
  "usage",
  "policy",
] as const);

export type RuntimeFailureCategory = (typeof runtimeFailureCategories)[number];

export type RuntimeFailureCode =
  | "RUNTIME_AUTH_FAILURE"
  | "RUNTIME_MODEL_FAILURE"
  | "RUNTIME_ENDPOINT_FAILURE"
  | "RUNTIME_PROTOCOL_FAILURE"
  | "RUNTIME_PROCESS_FAILURE"
  | "RUNTIME_CANCELLED"
  | "RUNTIME_USAGE_INTEGRITY_FAILURE"
  | "RUNTIME_POLICY_FAILURE";

export type PiAdapterFailureCauseCode =
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
  | "PI_RPC_USAGE_INTEGRITY_ERROR"
  | "PI_RPC_AGENT_ERROR"
  | "PI_RPC_RUNTIME_ERROR";

export type RuntimeFailureCauseCode =
  | RuntimeRejectionCode
  | "RUNTIME_TYPE_UNSUPPORTED"
  | PiAdapterFailureCauseCode;

export type RuntimeFailure = Readonly<{
  schemaVersion: typeof RUNTIME_FAILURE_SCHEMA_VERSION;
  code: RuntimeFailureCode;
  category: RuntimeFailureCategory;
  retryable: boolean;
  message: string;
  causeCode?: RuntimeFailureCauseCode;
}>;

type RuntimeFailureDefinition = Readonly<{
  category: RuntimeFailureCategory;
  message: string;
}>;

const RUNTIME_FAILURE_DEFINITIONS = {
  RUNTIME_AUTH_FAILURE: {
    category: "auth",
    message: "Runtime authentication failed.",
  },
  RUNTIME_MODEL_FAILURE: {
    category: "model",
    message: "Runtime model selection failed.",
  },
  RUNTIME_ENDPOINT_FAILURE: {
    category: "endpoint",
    message: "Runtime endpoint is unavailable.",
  },
  RUNTIME_PROTOCOL_FAILURE: {
    category: "protocol",
    message: "Runtime protocol validation failed.",
  },
  RUNTIME_PROCESS_FAILURE: {
    category: "process",
    message: "Runtime process failed.",
  },
  RUNTIME_CANCELLED: {
    category: "cancellation",
    message: "Runtime operation was cancelled.",
  },
  RUNTIME_USAGE_INTEGRITY_FAILURE: {
    category: "usage",
    message: "Runtime usage integrity validation failed.",
  },
  RUNTIME_POLICY_FAILURE: {
    category: "policy",
    message: "Runtime policy rejected the operation.",
  },
} as const satisfies Record<RuntimeFailureCode, RuntimeFailureDefinition>;

const RUNTIME_REJECTION_FAILURE_CODES = {
  RUNTIME_CODING_AGENT_UNSUPPORTED: "RUNTIME_POLICY_FAILURE",
  RUNTIME_AI_PROVIDER_UNSUPPORTED: "RUNTIME_ENDPOINT_FAILURE",
  RUNTIME_MODEL_UNSUPPORTED: "RUNTIME_MODEL_FAILURE",
  RUNTIME_AUTH_CLASS_UNSUPPORTED: "RUNTIME_AUTH_FAILURE",
  RUNTIME_CAPABILITY_UNSUPPORTED: "RUNTIME_POLICY_FAILURE",
  RUNTIME_ADMISSION_DISABLED: "RUNTIME_POLICY_FAILURE",
  RUNTIME_REGISTRY_VERSION_MISMATCH: "RUNTIME_POLICY_FAILURE",
  RUNTIME_REGISTRY_HASH_MISMATCH: "RUNTIME_POLICY_FAILURE",
  PI_AUTH_SETUP_TOKEN_DISABLED: "RUNTIME_AUTH_FAILURE",
  PI_AUTH_PROVIDER_OAUTH_DISABLED: "RUNTIME_AUTH_FAILURE",
  PI_AUTH_SUBSCRIPTION_DISABLED: "RUNTIME_AUTH_FAILURE",
  PI_CAPABILITY_MCP_DISABLED: "RUNTIME_POLICY_FAILURE",
  PI_CAPABILITY_BROWSER_DISABLED: "RUNTIME_POLICY_FAILURE",
  PI_CAPABILITY_EXTENSIONS_DISABLED: "RUNTIME_POLICY_FAILURE",
  PI_CAPABILITY_SANDBOX_DISABLED: "RUNTIME_POLICY_FAILURE",
  PI_CAPABILITY_PERMISSION_ENFORCEMENT_DISABLED: "RUNTIME_POLICY_FAILURE",
  PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED: "RUNTIME_POLICY_FAILURE",
  PI_CUSTOM_PROVIDER_DISABLED: "RUNTIME_POLICY_FAILURE",
} as const satisfies Record<RuntimeRejectionCode, RuntimeFailureCode>;

const PI_ADAPTER_FAILURE_CODES = {
  PI_RPC_AUTH_ERROR: "RUNTIME_AUTH_FAILURE",
  PI_RPC_CONFIG_ERROR: "RUNTIME_POLICY_FAILURE",
  PI_RPC_STATE_MISMATCH: "RUNTIME_MODEL_FAILURE",
  PI_RPC_MODEL_ERROR: "RUNTIME_MODEL_FAILURE",
  PI_RPC_ENDPOINT_ERROR: "RUNTIME_ENDPOINT_FAILURE",
  PI_RPC_PROTOCOL_ERROR: "RUNTIME_PROTOCOL_FAILURE",
  PI_RPC_PROCESS_EXIT: "RUNTIME_PROCESS_FAILURE",
  PI_RPC_PROCESS_SIGNAL: "RUNTIME_PROCESS_FAILURE",
  PI_RPC_STDIN_ERROR: "RUNTIME_PROCESS_FAILURE",
  PI_RPC_TIMEOUT: "RUNTIME_PROCESS_FAILURE",
  PI_RPC_CANCELLED: "RUNTIME_CANCELLED",
  PI_RPC_COMMAND_FAILED: "RUNTIME_PROCESS_FAILURE",
  PI_RPC_PROCESS_REAP_TIMEOUT: "RUNTIME_PROCESS_FAILURE",
  PI_PROCESS_GROUP_NOT_REAPED: "RUNTIME_PROCESS_FAILURE",
  PI_RPC_USAGE_INTEGRITY_ERROR: "RUNTIME_USAGE_INTEGRITY_FAILURE",
  PI_RPC_AGENT_ERROR: "RUNTIME_PROCESS_FAILURE",
  PI_RPC_RUNTIME_ERROR: "RUNTIME_PROCESS_FAILURE",
} as const satisfies Record<PiAdapterFailureCauseCode, RuntimeFailureCode>;

const CAUSE_FAILURE_CODES: Readonly<Record<RuntimeFailureCauseCode, RuntimeFailureCode>> = {
  ...RUNTIME_REJECTION_FAILURE_CODES,
  RUNTIME_TYPE_UNSUPPORTED: "RUNTIME_POLICY_FAILURE",
  ...PI_ADAPTER_FAILURE_CODES,
};

const runtimeFailureCodeSet = new Set<RuntimeFailureCode>(
  Object.keys(RUNTIME_FAILURE_DEFINITIONS) as RuntimeFailureCode[],
);
const runtimeFailureCauseCodeSet = new Set<RuntimeFailureCauseCode>(
  Object.keys(CAUSE_FAILURE_CODES) as RuntimeFailureCauseCode[],
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRuntimeFailureCode = (value: unknown): value is RuntimeFailureCode =>
  typeof value === "string" && runtimeFailureCodeSet.has(value as RuntimeFailureCode);

const isRuntimeFailureCauseCode = (
  value: unknown,
): value is RuntimeFailureCauseCode =>
  typeof value === "string" &&
  runtimeFailureCauseCodeSet.has(value as RuntimeFailureCauseCode);

const compatibleCauseCode = (
  code: RuntimeFailureCode,
  causeCode: unknown,
): RuntimeFailureCauseCode | undefined =>
  isRuntimeFailureCauseCode(causeCode) && CAUSE_FAILURE_CODES[causeCode] === code
    ? causeCode
    : undefined;

export const createRuntimeFailure = (
  code: RuntimeFailureCode,
  options: Readonly<{
    causeCode?: RuntimeFailureCauseCode;
    retryable?: boolean;
  }> = {},
): RuntimeFailure => {
  const definition = RUNTIME_FAILURE_DEFINITIONS[code];
  const retryable =
    code === "RUNTIME_PROCESS_FAILURE" && options.retryable === true;
  const causeCode = compatibleCauseCode(code, options.causeCode);

  return Object.freeze({
    schemaVersion: RUNTIME_FAILURE_SCHEMA_VERSION,
    code,
    category: definition.category,
    retryable,
    message: definition.message,
    ...(causeCode ? { causeCode } : {}),
  });
};

export const runtimeFailureFromRuntimeRejectionCode = (
  causeCode: RuntimeRejectionCode,
): RuntimeFailure =>
  createRuntimeFailure(RUNTIME_REJECTION_FAILURE_CODES[causeCode], { causeCode });

export const runtimeFailureFromPiAdapterCode = (
  causeCode: PiAdapterFailureCauseCode,
): RuntimeFailure =>
  createRuntimeFailure(PI_ADAPTER_FAILURE_CODES[causeCode], {
    causeCode,
    retryable: causeCode === "PI_RPC_TIMEOUT",
  });

export const runtimeFailureFromCauseCode = (
  causeCode: unknown,
): RuntimeFailure | null => {
  if (!isRuntimeFailureCauseCode(causeCode)) return null;
  return createRuntimeFailure(CAUSE_FAILURE_CODES[causeCode], {
    causeCode,
    retryable: causeCode === "PI_RPC_TIMEOUT",
  });
};

/**
 * Parses only the bounded taxonomy envelope. The supplied message is never
 * returned; a stable message is reconstructed from the safe failure code.
 */
export const parseRuntimeFailure = (input: unknown): RuntimeFailure | null => {
  if (!isRecord(input)) return null;
  if (input.schemaVersion !== RUNTIME_FAILURE_SCHEMA_VERSION) return null;
  if (!isRuntimeFailureCode(input.code)) return null;
  if (typeof input.message !== "string" || typeof input.retryable !== "boolean") {
    return null;
  }

  const definition = RUNTIME_FAILURE_DEFINITIONS[input.code];
  if (input.category !== definition.category) return null;
  if (input.retryable && input.code !== "RUNTIME_PROCESS_FAILURE") return null;

  let causeCode: RuntimeFailureCauseCode | undefined;
  if (input.causeCode !== undefined) {
    causeCode = compatibleCauseCode(input.code, input.causeCode);
    if (!causeCode) return null;
  }

  return createRuntimeFailure(input.code, {
    ...(causeCode ? { causeCode } : {}),
    retryable: input.retryable,
  });
};

/** Extracts direct or error-attached taxonomy metadata without inspecting text. */
export const extractRuntimeFailure = (input: unknown): RuntimeFailure | null => {
  const direct = parseRuntimeFailure(input);
  if (direct) return direct;
  if (!isRecord(input)) return null;
  return parseRuntimeFailure(input.runtimeFailure);
};
