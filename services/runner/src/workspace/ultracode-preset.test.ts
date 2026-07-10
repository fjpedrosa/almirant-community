import { describe, expect, it } from "bun:test";

import { resolveUltracode } from "./ultracode-preset";

describe("resolveUltracode", () => {
  it("forces xhigh reasoning, teaming, and subagentModel=resolvedModel when ultracode is true", () => {
    const result = resolveUltracode({
      ultracode: true,
      reasoningBudget: "medium",
      resolvedModel: "claude-opus-4-8",
      isZipuClaudeRuntime: false,
    });

    expect(result.reasoningBudget).toBe("xhigh");
    expect(result.enableTeaming).toBe(true);
    expect(result.subagentModel).toBe("claude-opus-4-8");
  });

  it("honors an explicit subagentModel when ultracode is true", () => {
    const result = resolveUltracode({
      ultracode: true,
      reasoningBudget: undefined,
      resolvedModel: "claude-opus-4-8",
      subagentModel: "claude-sonnet-5",
      isZipuClaudeRuntime: false,
    });

    expect(result.reasoningBudget).toBe("xhigh");
    expect(result.enableTeaming).toBe(true);
    expect(result.subagentModel).toBe("claude-sonnet-5");
  });

  it("passes reasoningBudget through and disables teaming when ultracode is absent (non-zai)", () => {
    const result = resolveUltracode({
      reasoningBudget: "high",
      resolvedModel: "claude-opus-4-8",
      isZipuClaudeRuntime: false,
    });

    expect(result.reasoningBudget).toBe("high");
    expect(result.enableTeaming).toBe(false);
    expect(result.subagentModel).toBeUndefined();
  });

  it("keeps teaming on and defaults subagentModel to resolvedModel when ultracode is absent but isZipuClaudeRuntime is true", () => {
    const result = resolveUltracode({
      reasoningBudget: undefined,
      resolvedModel: "glm-5.2",
      isZipuClaudeRuntime: true,
    });

    expect(result.reasoningBudget).toBeUndefined();
    expect(result.enableTeaming).toBe(true);
    expect(result.subagentModel).toBe("glm-5.2");
  });
});
