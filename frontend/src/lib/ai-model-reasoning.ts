import { getRuntimeCapabilityTuples } from "@/domains/agents/domain/coding-agent-compatibility";
import type { ReasoningBudget } from "@/domains/integrations/domain/types";
import generatedProjection from "@/generated/runtime-capability-projection.v1.json";

export type ReasoningEffortOption = {
  value: ReasoningBudget;
  label: string;
};

type ReasoningEffortContext = {
  codingAgent?: string | null;
  aiProvider?: string | null;
  model?: string | null;
};

const options = (
  values: readonly ReasoningBudget[],
): readonly ReasoningEffortOption[] =>
  values.map((value) => ({
    value,
    label: value === "xhigh" ? "XHigh" : `${value[0]?.toUpperCase()}${value.slice(1)}`,
  }));

const normalizeValue = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
};

/**
 * Preserve historical inference when callers omit aiProvider, while resolving
 * every model and effort list from the generated projection.
 */
const resolveReasoningAiProvider = (context: {
  codingAgent?: string;
  aiProvider?: string;
  model?: string;
}): string | undefined => {
  if (context.aiProvider) return context.aiProvider;
  if (context.codingAgent === "claude-code") return "anthropic";
  if (context.codingAgent === "codex") return "openai";
  if (!context.codingAgent && context.model?.startsWith("claude-")) {
    return "anthropic";
  }
  return undefined;
};

/**
 * Return only effort values carried by an admitted generated runtime tuple.
 * Empty means the UI must defer to the runtime instead of sending a value.
 */
export const getReasoningEffortOptions = (
  context: ReasoningEffortContext,
): readonly ReasoningEffortOption[] => {
  const codingAgent = normalizeValue(context.codingAgent);
  const aiProvider = resolveReasoningAiProvider({
    codingAgent,
    aiProvider: normalizeValue(context.aiProvider),
    model: normalizeValue(context.model),
  });
  const requestedModel = normalizeValue(context.model);

  if (!aiProvider) return [];

  const model = requestedModel ?? generatedProjection.defaults.find(
    (entry) => entry.aiProvider === aiProvider,
  )?.model;
  if (!model) return [];

  const tuple = getRuntimeCapabilityTuples({
    codingAgent,
    aiProvider,
    model,
    admissionEnabled: true,
  })[0];

  return tuple ? options(tuple.reasoningEfforts) : [];
};

/** Canonicalize an effort only when the selected model/runtime can serialize it. */
export const normalizeReasoningEffort = (
  context: ReasoningEffortContext,
  effort: string | null | undefined,
): ReasoningBudget | undefined => {
  const normalized = effort?.trim().toLowerCase();
  if (!normalized) return undefined;
  return getReasoningEffortOptions(context).some(({ value }) => value === normalized)
    ? normalized as ReasoningBudget
    : undefined;
};
