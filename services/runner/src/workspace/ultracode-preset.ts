/**
 * Pure resolution for the opt-in "ultracode" preset.
 *
 * When a job carries `ultracode: true`, the runner turns on the highest
 * reasoning effort verified for the resolved model plus multi-agent teaming.
 * It never guesses an effort for models whose runtime contract is unknown.
 * When the flag is absent, the resolution is a pass-through that preserves the
 * pre-existing behavior byte-for-byte: reasoning budget is left untouched and
 * teaming stays gated on the existing zai/Claude-compatible condition.
 *
 * This module is intentionally dependency-free (no `@almirant/*` imports) so it
 * can be unit-tested standalone under `bun test`.
 */

export type UltracodeResolution = {
  /** Model-supported maximum when ultracode is on, otherwise the input passthrough. */
  reasoningBudget: string | undefined;
  /** True when ultracode is on, otherwise the existing teaming condition. */
  enableTeaming: boolean;
  /**
   * Model to use for spawned subagents. An explicit `subagentModel` always wins;
   * otherwise it defaults to the resolved job model when teaming is enabled, and
   * is left undefined when teaming is disabled.
   */
  subagentModel: string | undefined;
};

export const resolveUltracode = (input: {
  ultracode?: boolean;
  /** Already-resolved reasoning budget (jobReasoningLevel ?? connection budget). */
  reasoningBudget: string | undefined;
  resolvedModel: string | undefined;
  subagentModel?: string;
  /** Existing teaming condition (zai/Claude-compatible runtime). */
  isZipuClaudeRuntime: boolean;
}): UltracodeResolution => {
  const enableTeaming = input.ultracode ? true : input.isZipuClaudeRuntime;
  const reasoningBudget = input.ultracode
    ? resolveUltracodeReasoningBudget(input.resolvedModel)
    : input.reasoningBudget;
  const subagentModel =
    input.subagentModel ?? (enableTeaming ? input.resolvedModel : undefined);

  return { reasoningBudget, enableTeaming, subagentModel };
};

const VERIFIED_MAX_CLAUDE_MODEL =
  /claude-(?:fable-5|opus-4-(?:6|7|8)|sonnet-(?:4-6|5))/;

const VERIFIED_XHIGH_OPENAI_MODELS = new Set([
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
]);

const resolveUltracodeReasoningBudget = (
  resolvedModel: string | undefined,
): string | undefined => {
  const model = resolvedModel?.trim().toLowerCase();
  if (!model) return undefined;

  if (model.includes("haiku")) return undefined;
  if (model === "glm-5.2" || model.startsWith("glm-5.2-")) return "max";
  if (model.startsWith("glm-")) return undefined;
  if (VERIFIED_MAX_CLAUDE_MODEL.test(model)) return "max";
  if (model.startsWith("claude-")) return undefined;
  if (VERIFIED_XHIGH_OPENAI_MODELS.has(model)) return "xhigh";

  return undefined;
};
