/**
 * Pure resolution for the opt-in "ultracode" preset.
 *
 * When a job carries `ultracode: true`, the runner turns on maximum reasoning
 * ("xhigh") and multi-agent teaming for the coding agent, regardless of runtime.
 * When the flag is absent, the resolution is a pass-through that preserves the
 * pre-existing behavior byte-for-byte: reasoning budget is left untouched and
 * teaming stays gated on the existing zai/Claude-compatible condition.
 *
 * This module is intentionally dependency-free (no `@almirant/*` imports) so it
 * can be unit-tested standalone under `bun test`.
 */

export type UltracodeResolution = {
  /** Forced to "xhigh" when ultracode is on, otherwise the input passthrough. */
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
  const reasoningBudget = input.ultracode ? "xhigh" : input.reasoningBudget;
  const subagentModel =
    input.subagentModel ?? (enableTeaming ? input.resolvedModel : undefined);

  return { reasoningBudget, enableTeaming, subagentModel };
};
