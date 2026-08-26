import {
  runtimeCapabilityRegistry,
  type RuntimeAiProvider,
} from "./runtime-capability-registry";

export type AgentAiProvider = RuntimeAiProvider;

/**
 * Legacy provider normalization for persisted rows and callers predating exact
 * runtime admission. Modern requests must use runtimeCapabilityRegistry.admit().
 */
const normalizeLegacyProvider = (
  provider: string | null | undefined,
): AgentAiProvider | null => {
  const value = provider?.trim().toLowerCase();
  if (value === "zipu") return "zai";
  if (value === "grok") return "xai";
  return runtimeCapabilityRegistry.aiProviders.some((entry) => entry === value)
    ? (value as AgentAiProvider)
    : null;
};

/**
 * Legacy model facade. It deliberately preserves historical trim/lowercase
 * behavior, while all authoritative model data comes from the runtime registry.
 * Modern admission is exact, case-sensitive, and never rewrites an explicit ID.
 */
export const normalizeAgentModel = (
  provider: string | null | undefined,
  model: string | null | undefined,
): string | null => {
  const normalizedProvider = normalizeLegacyProvider(provider);
  const normalizedModel = model?.trim().toLowerCase();
  if (!normalizedProvider || !normalizedModel) return null;

  return runtimeCapabilityRegistry
    .getModels(normalizedProvider)
    .some((entry) => entry.id === normalizedModel)
    ? normalizedModel
    : null;
};

export const getDefaultAgentModel = (
  provider: string | null | undefined,
): string | null => {
  const normalizedProvider = normalizeLegacyProvider(provider);
  return normalizedProvider
    ? runtimeCapabilityRegistry.getDefaultModel(normalizedProvider)
    : null;
};

/**
 * Null means the provider/model pair is unknown. An empty array means that the
 * model is entitled but no explicit reasoning effort may be serialized.
 */
export const getAgentModelReasoningEfforts = (
  provider: string | null | undefined,
  model: string | null | undefined,
): readonly string[] | null => {
  const normalizedProvider = normalizeLegacyProvider(provider);
  if (!normalizedProvider) return null;
  const normalizedModel = normalizeAgentModel(normalizedProvider, model);
  if (!normalizedModel) return null;

  return runtimeCapabilityRegistry.getReasoningEfforts(
    normalizedProvider,
    normalizedModel,
  );
};

export const getAgentModels = (
  provider: string | null | undefined,
): readonly string[] => {
  const normalizedProvider = normalizeLegacyProvider(provider);
  return normalizedProvider
    ? runtimeCapabilityRegistry
        .getModels(normalizedProvider)
        .map((entry) => entry.id)
    : [];
};
