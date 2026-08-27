import { resolveLegacyRuntimeSelection } from "./legacy-runtime-selection-adapter";

export type ScheduledRuntimeConnection = {
  config?: unknown;
};

export type ScheduledConnectionRuntimeInput = {
  aiProvider: string;
  jobType: string;
  connections: readonly ScheduledRuntimeConnection[];
};

export type ScheduledConnectionRuntime = Readonly<{
  model?: string;
  reasoningLevel: string | null;
}>;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Keep non-empty explicit model/reasoning identifiers byte-for-byte exact. */
const asExplicitString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const configuredModelForJob = (
  config: Record<string, unknown>,
  jobType: string,
): string | undefined => {
  if (jobType === "planning") return asExplicitString(config.planningModel);
  if (jobType === "validation") {
    return asExplicitString(config.validationModel) ??
      asExplicitString(config.implementationModel);
  }
  return asExplicitString(config.implementationModel);
};

const configuredReasoningForJob = (
  config: Record<string, unknown>,
  jobType: string,
): string | null => {
  if (jobType === "planning") {
    return asExplicitString(config.planningReasoningBudget) ?? null;
  }
  if (jobType === "validation") {
    return asExplicitString(config.validationReasoningBudget) ??
      asExplicitString(config.implementationReasoningBudget) ??
      null;
  }
  return asExplicitString(config.implementationReasoningBudget) ?? null;
};

/**
 * Resolve each connection's stage-specific model and reasoning as one pair.
 * Missing connection values stay missing; scheduled precedence, not this
 * projection, owns the final legacy-default layer.
 */
export const collectScheduledAgentConnectionRuntimes = (
  input: ScheduledConnectionRuntimeInput,
): ScheduledConnectionRuntime[] =>
  input.connections.map((connection) => {
    const config = asRecord(connection.config);
    const model = configuredModelForJob(config, input.jobType);
    return {
      ...(model === undefined ? {} : { model }),
      reasoningLevel: configuredReasoningForJob(config, input.jobType),
    };
  });

/** Compatibility facade for callers that still need only effective model ids. */
export const collectScheduledAgentEffectiveModels = (
  input: ScheduledConnectionRuntimeInput,
): string[] => {
  const defaultModel = resolveLegacyRuntimeSelection({
    provider: input.aiProvider,
  }).model;
  return [
    ...new Set(
      collectScheduledAgentConnectionRuntimes(input).flatMap((runtime) => {
        const model = runtime.model ?? defaultModel;
        return [model];
      }),
    ),
  ];
};

/**
 * Explicit AI-provider evidence remains exact. Genuinely missing legacy values
 * delegate provider aliases and fallback behavior to the named adapter.
 */
export const resolveScheduledAgentAiProvider = (input: {
  provider?: string | null;
  aiProvider?: string | null;
}): string => {
  if (
    typeof input.aiProvider === "string" &&
    input.aiProvider.trim().length > 0
  ) {
    return input.aiProvider;
  }
  return resolveLegacyRuntimeSelection({
    provider: input.provider ?? undefined,
  }).aiProvider;
};

export const normalizeScheduledAgentModel = (
  value: string | null | undefined,
): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;
