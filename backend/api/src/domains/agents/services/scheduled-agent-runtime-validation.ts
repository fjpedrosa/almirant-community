import { env } from "@almirant/config";
import {
  RESOLVED_SCHEDULED_RUNTIME_SCHEMA_VERSION,
  ScheduledRuntimeAdmissionError,
  deriveRuntimeCapabilityIntent,
  resolveLegacyRuntimeSelection,
  resolveRequestedRuntimeSelection,
  resolveScheduledRuntimePrecedence,
  runtimeCapabilityRegistry,
  type ResolvedRuntimeSelection,
  type ResolvedScheduledRuntime,
  type RuntimeCapabilityIntentErrorCode,
  type RuntimeRejectionCode,
  type ScheduledRuntimeSource,
} from "@almirant/shared";

export const SCHEDULED_AGENT_RUNTIME_VALIDATION_ERROR =
  "Invalid scheduled agent runtime";
const PI_ADMISSION_ENABLED = "PI_ADMISSION_ENABLED" as const;
export const PI_ADMISSION_DISABLED = "PI_ADMISSION_DISABLED" as const;

export type RuntimeValidationErrorCode =
  | RuntimeRejectionCode
  | RuntimeCapabilityIntentErrorCode
  | typeof PI_ADMISSION_DISABLED;

export class ScheduledAgentRuntimeValidationError extends Error {
  readonly category: "policy" | undefined;
  readonly retryable: false | undefined;

  constructor(
    message: string,
    readonly code: RuntimeValidationErrorCode | null = null,
  ) {
    super(`${SCHEDULED_AGENT_RUNTIME_VALIDATION_ERROR}: ${message}`);
    this.name = "ScheduledAgentRuntimeValidationError";
    this.category = code === PI_ADMISSION_DISABLED ? "policy" : undefined;
    this.retryable = code === PI_ADMISSION_DISABLED ? false : undefined;
  }
}

/**
 * Read the live process value so tests do not depend on module-cache resets.
 * Production falls back to the startup-validated config value when the variable
 * is absent. Legacy config mocks and mixed-version processes may omit the new
 * field entirely, so the compatibility boundary preserves its default-on policy.
 */
export const isPiCodingAgentAdmissionEnabled = (
  configuredValue = process.env.PI_CODING_AGENT_ADMISSION_ENABLED ??
    env.PI_CODING_AGENT_ADMISSION_ENABLED ??
    "true",
): boolean => {
  if (configuredValue === "true") return true;
  if (configuredValue === "false") return false;
  throw new Error("PI_CODING_AGENT_ADMISSION_ENABLED must be 'true' or 'false'");
};

/** Build a fresh, deeply immutable view of live runtime operator controls. */
export const buildRuntimeControls = () => {
  const enabled = isPiCodingAgentAdmissionEnabled();
  const piCodingAgentAdmission = Object.freeze({
    enabled,
    code: enabled ? PI_ADMISSION_ENABLED : PI_ADMISSION_DISABLED,
  });

  return Object.freeze({ piCodingAgentAdmission });
};

type EffectiveRuntimeInput = ScheduledRuntimeSource & {
  model: string;
};

export type RuntimeValidationInput = {
  provider?: string | null;
  codingAgent?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  reasoningLevel?: string | null;
  authClass?: string | null;
  capabilities?: readonly string[] | null;
  /** Every connection model that may be inherited after account fallback. */
  effectiveAiModels?: readonly string[];
  /** Fully resolved execution candidates, including project/connection precedence. */
  effectiveRuntimes?: ReadonlyArray<ResolvedScheduledRuntime | EffectiveRuntimeInput>;
  targetConfig?: unknown;
};

export type PersistedScheduledAgentRuntime = Pick<
  RuntimeValidationInput,
  "provider" | "codingAgent" | "aiProvider" | "aiModel" | "reasoningLevel"
>;

type OmittedPersistedReasoningLevel = {
  model: string;
  aiProvider: string;
  reasoningLevel: string;
};

const explicitString = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

/** Preserve non-empty modern model ids byte-for-byte for storage and admission. */
export const canonicalizeAiModelForStorage = (
  value: string | null | undefined,
): string | null => explicitString(value);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const fail = (
  message: string,
  code: RuntimeValidationErrorCode | null = null,
): never => {
  throw new ScheduledAgentRuntimeValidationError(message, code);
};

const assertPiCodingAgentAdmission = (codingAgent: string | null | undefined): void => {
  if (codingAgent === "pi" && !isPiCodingAgentAdmissionEnabled()) {
    fail(
      "Pi coding-agent admission is disabled by operator policy.",
      PI_ADMISSION_DISABLED,
    );
  }
};

export type RuntimeCapabilityAdmissionInput = {
  provider: string;
  codingAgent: string;
  aiProvider: string;
  model: string;
  config: unknown;
  /** Already-resolved auth is the fallback when the final config has no override. */
  authClass?: string | null;
};

/**
 * Derive auth/capability intent from the exact final enqueue config and admit the
 * complete runtime tuple before persistence. Known config values are never
 * reflected in failures; callers can safely expose the bounded typed code.
 */
export const assertRuntimeCapabilityIntentAdmission = (
  input: RuntimeCapabilityAdmissionInput,
): ResolvedRuntimeSelection => {
  assertPiCodingAgentAdmission(input.codingAgent);
  const intent = deriveRuntimeCapabilityIntent(input.config);
  if (!("intent" in intent)) {
    return fail(
      `runtime capability intent is invalid at field '${intent.field}'.`,
      intent.code,
    );
  }

  const resolution = resolveRequestedRuntimeSelection({
    provider: input.provider,
    codingAgent: input.codingAgent,
    aiProvider: input.aiProvider,
    model: input.model,
    authClass: intent.intent.authClass ?? input.authClass ?? "api_key",
    capabilities: intent.intent.capabilities,
  });
  if (!("selection" in resolution)) {
    return fail(
      `runtime capability intent was rejected with code '${resolution.code}'.`,
      resolution.code,
    );
  }
  return resolution.selection;
};

export const assertRuntimeCapabilityIntentAdmissions = (
  runtimes: readonly ResolvedScheduledRuntime[],
  config: unknown,
): readonly ResolvedRuntimeSelection[] =>
  runtimes.map((runtime) =>
    assertRuntimeCapabilityIntentAdmission({
      provider: runtime.provider,
      codingAgent: runtime.codingAgent,
      aiProvider: runtime.aiProvider,
      model: runtime.model,
      authClass: runtime.authClass,
      config,
    })
  );

const isScheduledRuntimeAdmissionError = (
  error: unknown,
): error is ScheduledRuntimeAdmissionError =>
  error instanceof ScheduledRuntimeAdmissionError;

const admissionFailureMessage = (
  scope: string,
  error: ScheduledRuntimeAdmissionError,
): string => {
  if (
    error.code === "RUNTIME_MODEL_UNSUPPORTED" &&
    error.candidate.aiProvider === "zai"
  ) {
    return `${scope}: model '${error.candidate.model}' is not available through the Z.AI Coding Plan.`;
  }

  return `${scope}: registry rejected the complete runtime tuple with code '${error.code}'.`;
};

const wrapAdmission = (
  scope: string,
  error: ScheduledRuntimeAdmissionError,
): never => fail(admissionFailureMessage(scope, error), error.code);

/**
 * Normalize registry failures thrown before this service receives resolved
 * candidates (for example, effective-runtime resolution in an API route).
 */
export const asScheduledAgentRuntimeValidationError = (
  error: unknown,
  scope = "agent effective runtime",
): ScheduledAgentRuntimeValidationError | null => {
  if (error instanceof ScheduledAgentRuntimeValidationError) return error;
  if (!isScheduledRuntimeAdmissionError(error)) return null;
  return new ScheduledAgentRuntimeValidationError(
    admissionFailureMessage(scope, error),
    error.code,
  );
};

const isResolvedScheduledRuntime = (
  runtime: ResolvedScheduledRuntime | EffectiveRuntimeInput,
): runtime is ResolvedScheduledRuntime =>
  "schemaVersion" in runtime &&
  runtime.schemaVersion === RESOLVED_SCHEDULED_RUNTIME_SCHEMA_VERSION;

const assertResolvedRegistryIdentity = (
  runtime: ResolvedScheduledRuntime,
  scope: string,
): void => {
  if (runtime.registryVersion !== runtimeCapabilityRegistry.version) {
    fail(
      `${scope}: runtime registry version does not match the authoritative registry.`,
      "RUNTIME_REGISTRY_VERSION_MISMATCH",
    );
  }
  if (runtime.projectionHash !== runtimeCapabilityRegistry.projectionHash) {
    fail(
      `${scope}: runtime registry projection does not match the authoritative registry.`,
      "RUNTIME_REGISTRY_HASH_MISMATCH",
    );
  }
};

const assertReasoning = (
  runtime: ResolvedScheduledRuntime,
  scope: string,
): void => {
  if (
    runtime.reasoningLevel !== null &&
    !runtime.reasoningEfforts.some((effort) => effort === runtime.reasoningLevel)
  ) {
    fail(
      `${scope}: reasoningLevel '${runtime.reasoningLevel}' is not supported by model '${runtime.model}'.`,
    );
  }
};

const resolveAndValidate = (
  sources: Parameters<typeof resolveScheduledRuntimePrecedence>[0],
  scope: string,
): ResolvedScheduledRuntime => {
  try {
    const runtime = resolveScheduledRuntimePrecedence(sources);
    assertPiCodingAgentAdmission(runtime.codingAgent);
    assertReasoning(runtime, scope);
    return runtime;
  } catch (error) {
    if (isScheduledRuntimeAdmissionError(error)) {
      return wrapAdmission(scope, error);
    }
    throw error;
  }
};

const validateEffectiveRuntime = (
  runtime: ResolvedScheduledRuntime | EffectiveRuntimeInput,
  scope: string,
): ResolvedScheduledRuntime => {
  if (isResolvedScheduledRuntime(runtime)) {
    assertPiCodingAgentAdmission(runtime.codingAgent);
    assertResolvedRegistryIdentity(runtime, scope);
    assertReasoning(runtime, scope);
    return runtime;
  }
  return resolveAndValidate({ schedule: runtime }, scope);
};

const scheduledSource = (
  input: RuntimeValidationInput,
  model?: string | null,
): ScheduledRuntimeSource => ({
  provider: input.provider,
  codingAgent: input.codingAgent,
  aiProvider: input.aiProvider,
  model,
  reasoningLevel: input.reasoningLevel,
  authClass: input.authClass,
  capabilities: input.capabilities,
});

const projectRules = (
  key: "backlogDrain" | "dodRemediation",
  targetConfig: unknown,
): Array<{ index: number; source: ScheduledRuntimeSource }> => {
  const target = asRecord(targetConfig);
  const config = asRecord(target?.[key]);
  const projects = Array.isArray(config?.projects) ? config.projects : [];

  return projects.flatMap((entry, index) => {
    const rule = asRecord(entry);
    if (!rule) return [];
    return [{
      index,
      source: {
        provider: typeof rule.provider === "string" ? rule.provider : null,
        codingAgent: typeof rule.codingAgent === "string" ? rule.codingAgent : null,
        aiProvider: typeof rule.aiProvider === "string" ? rule.aiProvider : null,
        model: typeof rule.model === "string" ? rule.model : null,
        reasoningLevel: typeof rule.reasoningLevel === "string"
          ? rule.reasoningLevel
          : null,
        authClass: typeof rule.authClass === "string" ? rule.authClass : null,
        capabilities: Array.isArray(rule.capabilities)
          ? rule.capabilities.filter((value): value is string => typeof value === "string")
          : null,
      },
    }];
  });
};

/**
 * Validate scheduled candidates through the same fieldwise resolver used by
 * execution. A complete candidate is admitted once; already-admitted resolver
 * output is checked for registry identity and reasoning without re-admission.
 */
export const assertValidScheduledAgentRuntime = (
  input: RuntimeValidationInput,
): readonly ResolvedScheduledRuntime[] => {
  assertPiCodingAgentAdmission(input.codingAgent);
  if (input.effectiveRuntimes !== undefined) {
    if (input.effectiveRuntimes.length === 0) {
      fail(
        "agent: could not resolve an effective model from project defaults or an active provider connection.",
      );
    }
    return input.effectiveRuntimes.map((runtime) =>
      validateEffectiveRuntime(runtime, "agent effective runtime")
    );
  }

  const explicitModel = explicitString(input.aiModel);
  const effectiveModels = explicitModel
    ? [explicitModel]
    : input.effectiveAiModels === undefined
      ? []
      : [...new Set(input.effectiveAiModels.flatMap((model) => {
          const explicit = explicitString(model);
          return explicit === null ? [] : [explicit];
        }))];

  if (
    !explicitModel &&
    input.effectiveAiModels !== undefined &&
    effectiveModels.length === 0
  ) {
    fail("agent: could not resolve an effective model from an active provider connection.");
  }

  const runtimes = (effectiveModels.length > 0 ? effectiveModels : [null]).map((model) =>
    resolveAndValidate({ schedule: scheduledSource(input, model) }, "agent")
  );

  const schedule = scheduledSource(input, explicitModel);
  for (const key of ["backlogDrain", "dodRemediation"] as const) {
    for (const rule of projectRules(key, input.targetConfig)) {
      runtimes.push(resolveAndValidate(
        { rule: rule.source, schedule },
        `targetConfig.${key}.projects[${rule.index}]`,
      ));
    }
  }

  return runtimes;
};

/**
 * Compatibility boundary for runtimes persisted before explicit reasoning
 * support. Defaults and aliases delegate to the named legacy adapter; model ids
 * remain exact and model-prefix provider inference is deliberately absent.
 */
export const normalizePersistedScheduledAgentRuntime = (
  runtime: PersistedScheduledAgentRuntime,
): {
  runtime: PersistedScheduledAgentRuntime;
  omittedReasoningLevels: OmittedPersistedReasoningLevel[];
} => {
  const model = explicitString(runtime.aiModel);
  const reasoningLevel = explicitString(runtime.reasoningLevel);
  if (!model || !reasoningLevel) {
    return { runtime, omittedReasoningLevels: [] };
  }

  let aiProvider = explicitString(runtime.aiProvider);
  if (!aiProvider) {
    try {
      aiProvider = resolveLegacyRuntimeSelection({
        provider: runtime.provider ?? undefined,
        codingAgent: runtime.codingAgent ?? undefined,
        model,
      }).aiProvider;
    } catch {
      return { runtime, omittedReasoningLevels: [] };
    }
  }

  const efforts = runtimeCapabilityRegistry.getReasoningEfforts(aiProvider, model);
  if (
    efforts === null ||
    efforts.length !== 0 ||
    aiProvider !== "anthropic" ||
    model !== "claude-haiku-4-5"
  ) {
    return { runtime, omittedReasoningLevels: [] };
  }

  return {
    runtime: { ...runtime, reasoningLevel: undefined },
    omittedReasoningLevels: [{ model, aiProvider, reasoningLevel }],
  };
};
