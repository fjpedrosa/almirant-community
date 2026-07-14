export type AgentAiProvider = "anthropic" | "openai" | "google" | "zai" | "xai";

const MODEL_CATALOG: Record<AgentAiProvider, readonly string[]> = {
  anthropic: [
    "claude-opus-4-8",
    "claude-fable-5",
    "claude-opus-4-7",
    "claude-sonnet-5",
    "claude-haiku-4-5",
    // Kept for existing connections and scheduled-agent configurations.
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-opus-4-5",
    "claude-sonnet-4-5",
  ],
  openai: [
    "gpt-5.6",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-pro",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.3-codex",
    "gpt-4.1",
    "gpt-4.1-mini",
  ],
  google: [
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ],
  // Agent execution with Z.AI uses the Coding Plan endpoint. General API/VLM
  // slugs are deliberately absent even if the generic catalogue knows them.
  zai: [
    "glm-5.2",
    "glm-5.1",
    "glm-5",
    "glm-5-turbo",
    "glm-4.7",
    "glm-4.6",
    "glm-4.5",
    "glm-4.5-air",
  ],
  xai: [
    "grok-4.3",
    "grok-4.20-reasoning",
    "grok-4.20-multi-agent",
    "grok-4.20",
    "grok-build-0.1",
  ],
};

const DEFAULT_MODELS: Record<AgentAiProvider, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-5.6-sol",
  google: "gemini-3.1-pro-preview",
  zai: "glm-5.2",
  xai: "grok-4.3",
};

const CURRENT_OPENAI = new Set([
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.3-codex",
]);
const PRO_OPENAI = new Set(["gpt-5.5-pro", "gpt-5.4-pro"]);

const normalizeProvider = (provider: string | null | undefined): AgentAiProvider | null => {
  const value = provider?.trim().toLowerCase();
  if (value === "zipu") return "zai";
  if (value === "grok") return "xai";
  return value === "anthropic" || value === "openai" || value === "google" ||
    value === "zai" || value === "xai"
    ? value
    : null;
};

export const normalizeAgentModel = (
  provider: string | null | undefined,
  model: string | null | undefined,
): string | null => {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = model?.trim().toLowerCase();
  if (!normalizedProvider || !normalizedModel) return null;
  return MODEL_CATALOG[normalizedProvider].includes(normalizedModel)
    ? normalizedModel
    : null;
};

export const getDefaultAgentModel = (
  provider: string | null | undefined,
): string | null => {
  const normalizedProvider = normalizeProvider(provider);
  return normalizedProvider ? DEFAULT_MODELS[normalizedProvider] : null;
};

/**
 * Null means the provider/model pair is unknown. An empty array means that the
 * model is entitled but no explicit reasoning effort may be serialized.
 */
export const getAgentModelReasoningEfforts = (
  provider: string | null | undefined,
  model: string | null | undefined,
): readonly string[] | null => {
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) return null;
  const normalizedModel = normalizeAgentModel(normalizedProvider, model);
  if (!normalizedModel) return null;

  if (normalizedProvider === "openai") {
    if (PRO_OPENAI.has(normalizedModel)) return ["medium", "high", "xhigh"];
    if (CURRENT_OPENAI.has(normalizedModel)) return ["low", "medium", "high", "xhigh"];
    return [];
  }

  if (normalizedProvider === "anthropic") {
    if (normalizedModel.includes("haiku")) return [];
    if (/claude-(?:opus|sonnet)-4-6/.test(normalizedModel)) {
      return ["low", "medium", "high", "max"];
    }
    if (/claude-(?:fable-5|opus-4-(?:7|8)|sonnet-5)/.test(normalizedModel)) {
      return ["low", "medium", "high", "xhigh", "max"];
    }
    return [];
  }

  if (normalizedProvider === "zai" && normalizedModel === "glm-5.2") {
    return ["high", "max"];
  }

  return [];
};

export const getAgentModels = (
  provider: string | null | undefined,
): readonly string[] => {
  const normalizedProvider = normalizeProvider(provider);
  return normalizedProvider ? MODEL_CATALOG[normalizedProvider] : [];
};
