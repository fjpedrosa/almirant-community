import type { ReasoningBudget } from "@/domains/integrations/domain/types";

export type ReasoningEffortOption = {
  value: ReasoningBudget;
  label: string;
};

type ReasoningEffortContext = {
  codingAgent?: "claude-code" | "codex" | "opencode" | string | null;
  aiProvider?: "anthropic" | "openai" | "zai" | "xai" | string | null;
  model?: string | null;
};

const options = (
  values: readonly ReasoningBudget[],
): readonly ReasoningEffortOption[] =>
  values.map((value) => ({
    value,
    label: value === "xhigh" ? "XHigh" : `${value[0]?.toUpperCase()}${value.slice(1)}`,
  }));

// `none` means omitting modelReasoningEffort in codex-sdk. The SDK's typed
// ThreadOptions cannot serialize GPT-5.6's API-only `max`, and `minimal` is not
// a documented effort for the current selectable GPT models.
const CODEX_CURRENT_EFFORTS = options(["low", "medium", "high", "xhigh"]);
const CODEX_PRO_EFFORTS = options(["medium", "high", "xhigh"]);
const CLAUDE_CURRENT_EFFORTS = options(["low", "medium", "high", "xhigh", "max"]);
const CLAUDE_46_EFFORTS = options(["low", "medium", "high", "max"]);
const GLM_52_CODING_PLAN_EFFORTS = options(["high", "max"]);

const CODEX_CURRENT_MODELS = new Set([
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

const CODEX_PRO_MODELS = new Set([
  "gpt-5.5-pro",
  "gpt-5.4-pro",
]);

const supportsCurrentClaudeEffort = (model: string): boolean =>
  /claude-(?:fable-5|opus-4-(?:7|8)|sonnet-5)/.test(model);

/**
 * Return only effort values verified for the selected runtime/model pair.
 * Empty means the UI must defer to the runtime instead of sending an
 * unsupported value (notably Claude Haiku and non-5.2 Coding Plan models).
 */
export const getReasoningEffortOptions = (
  context: ReasoningEffortContext,
): readonly ReasoningEffortOption[] => {
  const aiProvider = context.aiProvider?.trim().toLowerCase();
  const codingAgent = context.codingAgent?.trim().toLowerCase();
  const model = context.model?.trim().toLowerCase() ?? "";

  if (aiProvider === "zai") {
    return model === "" || model === "glm-5.2"
      ? GLM_52_CODING_PLAN_EFFORTS
      : [];
  }

  if (aiProvider === "anthropic" || codingAgent === "claude-code" || model.startsWith("claude-")) {
    if (model.includes("haiku")) return [];
    if (/claude-(?:opus|sonnet)-4-6/.test(model)) return CLAUDE_46_EFFORTS;
    if (model === "" || supportsCurrentClaudeEffort(model)) return CLAUDE_CURRENT_EFFORTS;
    return [];
  }

  if (aiProvider === "openai" || codingAgent === "codex") {
    if (model === "") return CODEX_CURRENT_EFFORTS;
    if (CODEX_PRO_MODELS.has(model)) return CODEX_PRO_EFFORTS;
    if (CODEX_CURRENT_MODELS.has(model)) return CODEX_CURRENT_EFFORTS;
    return [];
  }

  return [];
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
