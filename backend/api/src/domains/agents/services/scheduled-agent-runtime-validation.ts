export const SCHEDULED_AGENT_RUNTIME_VALIDATION_ERROR =
  "Invalid scheduled agent runtime";

type AgentProvider = "claude-code" | "codex" | "zipu" | "grok";
type AiProvider = "anthropic" | "openai" | "zai" | "xai";

type RuntimeValidationInput = {
  provider?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  targetConfig?: unknown;
};

const AI_PROVIDER_TO_AGENT_PROVIDER: Record<AiProvider, AgentProvider> = {
  anthropic: "claude-code",
  openai: "codex",
  zai: "zipu",
  xai: "grok",
};

const AGENT_PROVIDER_TO_AI_PROVIDER: Record<AgentProvider, AiProvider> = {
  "claude-code": "anthropic",
  codex: "openai",
  zipu: "zai",
  grok: "xai",
};

const normalize = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const asAgentProvider = (value: string | null): AgentProvider | null => {
  return value === "claude-code" ||
    value === "codex" ||
    value === "zipu" ||
    value === "grok"
    ? value
    : null;
};

const asAiProvider = (value: string | null): AiProvider | null => {
  return value === "anthropic" ||
    value === "openai" ||
    value === "zai" ||
    value === "xai"
    ? value
    : null;
};

const inferAiProviderFromModel = (model: string | null | undefined): AiProvider | null => {
  const normalized = normalize(model);
  if (!normalized) return null;

  if (normalized.startsWith("glm-")) return "zai";
  if (normalized.startsWith("grok-")) return "xai";
  if (normalized.startsWith("claude-")) return "anthropic";
  if (
    normalized.startsWith("gpt-") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.startsWith("o5") ||
    normalized.startsWith("codex-")
  ) {
    return "openai";
  }

  return null;
};

const fail = (message: string): never => {
  throw new Error(`${SCHEDULED_AGENT_RUNTIME_VALIDATION_ERROR}: ${message}`);
};

const validateProviderAndModel = (params: {
  scope: string;
  provider?: string | null;
  explicitAiProvider?: string | null;
  effectiveAiProvider?: string | null;
  model?: string | null;
}): void => {
  const provider = asAgentProvider(normalize(params.provider));
  const explicitAiProvider = normalize(params.explicitAiProvider);
  const effectiveAiProvider = asAiProvider(
    normalize(params.effectiveAiProvider) ??
      explicitAiProvider ??
      (provider ? AGENT_PROVIDER_TO_AI_PROVIDER[provider] : null),
  );

  if (explicitAiProvider && !asAiProvider(explicitAiProvider)) {
    fail(`${params.scope}: unsupported aiProvider '${explicitAiProvider}'. Supported providers: anthropic, openai, zai, xai.`);
  }

  if (provider && explicitAiProvider) {
    const requiredProvider = AI_PROVIDER_TO_AGENT_PROVIDER[explicitAiProvider as AiProvider];
    if (provider !== requiredProvider) {
      fail(
        `${params.scope}: aiProvider '${explicitAiProvider}' requires provider '${requiredProvider}', ` +
          `but received provider '${provider}'. Use provider='${requiredProvider}' for ${explicitAiProvider} models.`,
      );
    }
  }

  const modelAiProvider = inferAiProviderFromModel(params.model);
  if (!modelAiProvider) return;

  if (effectiveAiProvider && effectiveAiProvider !== modelAiProvider) {
    fail(
      `${params.scope}: model '${params.model}' belongs to aiProvider '${modelAiProvider}', ` +
        `but the effective aiProvider is '${effectiveAiProvider}'.`,
    );
  }

  if (provider) {
    const requiredProvider = AI_PROVIDER_TO_AGENT_PROVIDER[modelAiProvider];
    if (provider !== requiredProvider) {
      fail(
        `${params.scope}: model '${params.model}' requires provider '${requiredProvider}', ` +
          `but received provider '${provider}'.`,
      );
    }
  }
};

const validateBacklogStyleTarget = (
  key: "backlogDrain" | "dodRemediation",
  target: Record<string, unknown> | null,
  topLevelAiProvider: string | null,
): void => {
  const config = asRecord(target?.[key]);
  const projects = Array.isArray(config?.projects) ? config.projects : [];

  projects.forEach((entry, index) => {
    const rule = asRecord(entry);
    if (!rule) return;
    validateProviderAndModel({
      scope: `targetConfig.${key}.projects[${index}]`,
      explicitAiProvider: normalize(rule.aiProvider as string | null | undefined),
      effectiveAiProvider: normalize(rule.aiProvider as string | null | undefined) ?? topLevelAiProvider,
      model: normalize(rule.model as string | null | undefined),
    });
  });
};

export const assertValidScheduledAgentRuntime = (
  input: RuntimeValidationInput,
): void => {
  const provider = normalize(input.provider);
  const explicitAiProvider = normalize(input.aiProvider);
  const topLevelAiProvider =
    explicitAiProvider ??
    (asAgentProvider(provider) ? AGENT_PROVIDER_TO_AI_PROVIDER[provider as AgentProvider] : null);

  validateProviderAndModel({
    scope: "agent",
    provider,
    explicitAiProvider,
    effectiveAiProvider: topLevelAiProvider,
    model: normalize(input.aiModel),
  });

  const targetConfig = asRecord(input.targetConfig);
  validateBacklogStyleTarget("backlogDrain", targetConfig, topLevelAiProvider);
  validateBacklogStyleTarget("dodRemediation", targetConfig, topLevelAiProvider);
};
