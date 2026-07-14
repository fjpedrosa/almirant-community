import {
  getAgentModelReasoningEfforts,
  normalizeAgentModel,
} from "@almirant/shared";

export const SCHEDULED_AGENT_RUNTIME_VALIDATION_ERROR =
  "Invalid scheduled agent runtime";

type AgentProvider = "claude-code" | "codex" | "zipu" | "grok";
type AiProvider = "anthropic" | "openai" | "zai" | "xai";
type CodingAgent = "claude-code" | "codex" | "codex-cli" | "opencode";

type RuntimeValidationInput = {
  provider?: string | null;
  codingAgent?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  reasoningLevel?: string | null;
  /** Every connection model that may be inherited after account fallback. */
  effectiveAiModels?: readonly string[];
  /** Fully resolved execution candidates, including project/connection precedence. */
  effectiveRuntimes?: ReadonlyArray<{
    provider?: string | null;
    codingAgent?: string | null;
    aiProvider?: string | null;
    model: string;
    reasoningLevel?: string | null;
  }>;
  targetConfig?: unknown;
};

const CODING_AGENTS_BY_PROVIDER: Record<AgentProvider, ReadonlySet<CodingAgent>> = {
  "claude-code": new Set(["claude-code"]),
  codex: new Set(["codex", "codex-cli", "opencode"]),
  zipu: new Set(["claude-code", "opencode"]),
  grok: new Set(["opencode"]),
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

const asCodingAgent = (value: string | null): CodingAgent | null => {
  return value === "claude-code" ||
    value === "codex" ||
    value === "codex-cli" ||
    value === "opencode"
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
  codingAgent?: string | null;
  explicitAiProvider?: string | null;
  effectiveAiProvider?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
}): void => {
  const provider = asAgentProvider(normalize(params.provider));
  const rawCodingAgent = normalize(params.codingAgent);
  const codingAgent = asCodingAgent(rawCodingAgent);
  const explicitAiProvider = normalize(params.explicitAiProvider);
  const effectiveAiProvider = asAiProvider(
    normalize(params.effectiveAiProvider) ??
      explicitAiProvider ??
      (provider ? AGENT_PROVIDER_TO_AI_PROVIDER[provider] : null),
  );

  if (explicitAiProvider && !asAiProvider(explicitAiProvider)) {
    fail(`${params.scope}: unsupported aiProvider '${explicitAiProvider}'. Supported providers: anthropic, openai, zai, xai.`);
  }

  if (rawCodingAgent && !codingAgent) {
    fail(`${params.scope}: unsupported codingAgent '${rawCodingAgent}'.`);
  }

  if (provider && codingAgent && !CODING_AGENTS_BY_PROVIDER[provider].has(codingAgent)) {
    fail(
      `${params.scope}: codingAgent '${codingAgent}' is not compatible with provider '${provider}'.`,
    );
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
  if (!modelAiProvider) {
    if (normalize(params.model)) {
      fail(`${params.scope}: model '${params.model}' is unknown or unsupported.`);
    }
    if (normalize(params.reasoningLevel)) {
      fail(`${params.scope}: could not validate reasoningLevel without a recognized effective model.`);
    }
    return;
  }

  const normalizedModel = normalize(params.model);
  if (!normalizedModel || !normalizeAgentModel(modelAiProvider, normalizedModel)) {
    if (modelAiProvider === "zai") {
      fail(
        `${params.scope}: model '${params.model}' is not available through the Z.AI Coding Plan.`,
      );
    }
    fail(
      `${params.scope}: model '${params.model}' is unknown or not available through ` +
        `the '${modelAiProvider}' agent runtime.`,
    );
  }

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

  const reasoningLevel = normalize(params.reasoningLevel);
  if (reasoningLevel && normalizedModel) {
    const efforts = getAgentModelReasoningEfforts(modelAiProvider, normalizedModel);
    if (!efforts?.includes(reasoningLevel)) {
      fail(
        `${params.scope}: reasoningLevel '${reasoningLevel}' is not supported by model '${params.model}'.`,
      );
    }
  }
};

const validateBacklogStyleTarget = (
  key: "backlogDrain" | "dodRemediation",
  target: Record<string, unknown> | null,
  topLevelProvider: string | null,
  topLevelAiProvider: string | null,
): void => {
  const config = asRecord(target?.[key]);
  const projects = Array.isArray(config?.projects) ? config.projects : [];

  projects.forEach((entry, index) => {
    const rule = asRecord(entry);
    if (!rule) return;
    const ruleAiProvider = normalize(rule.aiProvider as string | null | undefined);
    const ruleProvider = ruleAiProvider && asAiProvider(ruleAiProvider)
      ? AI_PROVIDER_TO_AGENT_PROVIDER[ruleAiProvider as AiProvider]
      : topLevelProvider;
    validateProviderAndModel({
      scope: `targetConfig.${key}.projects[${index}]`,
      provider: ruleProvider,
      codingAgent: normalize(rule.codingAgent as string | null | undefined),
      explicitAiProvider: ruleAiProvider,
      effectiveAiProvider: ruleAiProvider ?? topLevelAiProvider,
      model: normalize(rule.model as string | null | undefined),
      reasoningLevel: normalize(rule.reasoningLevel as string | null | undefined),
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
    codingAgent: normalize(input.codingAgent),
    explicitAiProvider,
    effectiveAiProvider: topLevelAiProvider,
    model: null,
  });

  const explicitModel = normalize(input.aiModel);
  if (input.effectiveRuntimes !== undefined) {
    if (input.effectiveRuntimes.length === 0) {
      fail("agent: could not resolve an effective model from project defaults or an active provider connection.");
    }
    for (const runtime of input.effectiveRuntimes) {
      validateProviderAndModel({
        scope: "agent effective runtime",
        provider: runtime.provider,
        codingAgent: runtime.codingAgent,
        explicitAiProvider: runtime.aiProvider,
        effectiveAiProvider: runtime.aiProvider,
        model: runtime.model,
        reasoningLevel: runtime.reasoningLevel,
      });
    }
  }

  const effectiveModels = explicitModel
    ? [explicitModel]
    : input.effectiveAiModels === undefined
      ? []
      : [...new Set(input.effectiveAiModels.map((model) => normalize(model)).filter((model): model is string => Boolean(model)))];

  if (
    input.effectiveRuntimes === undefined &&
    !explicitModel &&
    input.effectiveAiModels !== undefined &&
    effectiveModels.length === 0
  ) {
    fail("agent: could not resolve an effective model from an active provider connection.");
  }

  if (!explicitModel && effectiveModels.length === 0 && normalize(input.reasoningLevel)) {
    fail("agent: could not resolve an effective model for reasoningLevel validation.");
  }

  for (const model of input.effectiveRuntimes === undefined ? effectiveModels : []) {
    validateProviderAndModel({
      scope: "agent",
      provider,
      codingAgent: normalize(input.codingAgent),
      explicitAiProvider,
      effectiveAiProvider: topLevelAiProvider,
      model,
      reasoningLevel: normalize(input.reasoningLevel),
    });
  }

  const targetConfig = asRecord(input.targetConfig);
  validateBacklogStyleTarget("backlogDrain", targetConfig, provider, topLevelAiProvider);
  validateBacklogStyleTarget("dodRemediation", targetConfig, provider, topLevelAiProvider);
};
