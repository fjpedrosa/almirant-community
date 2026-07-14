import {
  getAgentModelReasoningEfforts,
  getDefaultAgentModel,
  normalizeAgentModel,
} from "@almirant/shared";

export const ZAI_CODING_PLAN_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
export const AI_CONNECTION_CONFIG_ERROR = "Invalid AI connection config";

const MODEL_FIELDS = [
  "planningModel",
  "implementationModel",
  "validationModel",
] as const;

const REASONING_FIELD_BY_MODEL = {
  planningModel: "planningReasoningBudget",
  implementationModel: "implementationReasoningBudget",
  validationModel: "validationReasoningBudget",
} as const;

const fail = (message: string): never => {
  throw new Error(`${AI_CONNECTION_CONFIG_ERROR}: ${message}`);
};

const normalizedText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

export const normalizeAiConnectionConfig = (input: {
  provider: string;
  category: string;
  config?: Record<string, unknown> | null;
}): Record<string, unknown> => {
  const config = { ...(input.config ?? {}) };
  if (input.category.trim().toLowerCase() !== "ai") return config;

  const provider = input.provider.trim().toLowerCase();
  const defaultModel = getDefaultAgentModel(provider);
  if (!defaultModel) {
    fail(`provider '${input.provider}' has no supported agent-runtime model catalogue.`);
  }

  if (provider === "zai" || provider === "zipu") {
    const requestedPlan = normalizedText(config.zaiPlan);
    if (requestedPlan && requestedPlan !== "coding") {
      fail("Z.AI agent connections require zaiPlan='coding'.");
    }

    const requestedBaseUrl = typeof config.baseUrl === "string"
      ? config.baseUrl.trim().replace(/\/+$/, "")
      : null;
    if (requestedBaseUrl && requestedBaseUrl !== ZAI_CODING_PLAN_BASE_URL) {
      fail(`Z.AI Coding Plan requires endpoint '${ZAI_CODING_PLAN_BASE_URL}'.`);
    }
    config.zaiPlan = "coding";
    config.baseUrl = ZAI_CODING_PLAN_BASE_URL;
  }

  for (const modelField of MODEL_FIELDS) {
    const reasoningField = REASONING_FIELD_BY_MODEL[modelField];
    const rawModel = config[modelField];
    let effectiveModel = defaultModel;

    if (rawModel !== undefined && rawModel !== null) {
      const requestedModel = normalizedText(rawModel);
      if (!requestedModel) {
        delete config[modelField];
      } else {
        const model = normalizeAgentModel(provider, requestedModel);
        if (!model) {
          fail(`model '${String(rawModel)}' is unknown or unavailable for provider '${provider}'.`);
        }
        config[modelField] = model;
        effectiveModel = model;
      }
    }

    const rawReasoning = config[reasoningField];
    if (rawReasoning === undefined || rawReasoning === null) continue;
    const reasoning = normalizedText(rawReasoning);
    if (!reasoning) {
      delete config[reasoningField];
      continue;
    }

    const efforts = getAgentModelReasoningEfforts(provider, effectiveModel);
    if (!efforts?.includes(reasoning)) {
      fail(
        `reasoning '${String(rawReasoning)}' is not supported by model '${effectiveModel}' ` +
          `for ${reasoningField}.`,
      );
    }
    config[reasoningField] = reasoning;
  }

  return config;
};
