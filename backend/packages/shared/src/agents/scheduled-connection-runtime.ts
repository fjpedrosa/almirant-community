export type ScheduledRuntimeConnection = {
  config?: unknown;
};

export type ScheduledConnectionRuntimeInput = {
  aiProvider: string;
  jobType: string;
  connections: readonly ScheduledRuntimeConnection[];
};

const DEFAULT_MODEL_BY_AI_PROVIDER: Record<string, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-5.6-sol",
  zai: "glm-5.2",
  xai: "grok-4.3",
};

export const AI_PROVIDER_BY_AGENT_PROVIDER: Record<string, string> = {
  "claude-code": "anthropic",
  codex: "openai",
  zipu: "zai",
  grok: "xai",
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asModel = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const configuredModelForJob = (
  config: Record<string, unknown>,
  jobType: string,
): string | undefined => {
  if (jobType === "planning") return asModel(config.planningModel);
  if (jobType === "validation") {
    return asModel(config.validationModel) ?? asModel(config.implementationModel);
  }
  return asModel(config.implementationModel);
};

const configuredReasoningForJob = (
  config: Record<string, unknown>,
  jobType: string,
): string | null => {
  if (jobType === "planning") {
    return asModel(config.planningReasoningBudget) ?? null;
  }
  if (jobType === "validation") {
    return asModel(config.validationReasoningBudget) ??
      asModel(config.implementationReasoningBudget) ??
      null;
  }
  return asModel(config.implementationReasoningBudget) ?? null;
};

/**
 * Resolve stage-specific model/reasoning from active connections in their
 * repository-provided priority order. API validation enumerates every entry;
 * execution selects the first entry from this exact same list.
 */
export const collectScheduledAgentConnectionRuntimes = (
  input: ScheduledConnectionRuntimeInput,
): Array<{ model: string; reasoningLevel: string | null }> => {
  if (input.connections.length === 0) return [];
  const fallback = DEFAULT_MODEL_BY_AI_PROVIDER[input.aiProvider.trim().toLowerCase()];

  return input.connections.flatMap((connection) => {
    const config = asRecord(connection.config);
    const model = configuredModelForJob(config, input.jobType) ?? fallback;
    return model
      ? [{ model, reasoningLevel: configuredReasoningForJob(config, input.jobType) }]
      : [];
  });
};

export const collectScheduledAgentEffectiveModels = (
  input: ScheduledConnectionRuntimeInput,
): string[] => [
  ...new Set(
    collectScheduledAgentConnectionRuntimes(input).map(({ model }) => model),
  ),
];

export const resolveScheduledAgentAiProvider = (input: {
  provider?: string | null;
  aiProvider?: string | null;
}): string | undefined => {
  const provider = input.provider?.trim().toLowerCase() ?? "";
  const aiProvider = input.aiProvider?.trim().toLowerCase();
  return aiProvider || AI_PROVIDER_BY_AGENT_PROVIDER[provider];
};

export const normalizeScheduledAgentModel = asModel;
