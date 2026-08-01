import { describe, expect, it } from "bun:test";

import { resolveUltracode } from "./ultracode-preset";

describe("resolveUltracode", () => {
  it("uses the verified maximum Claude effort with teaming when ultracode is true", () => {
    const result = resolveUltracode({
      ultracode: true,
      reasoningBudget: "medium",
      resolvedModel: "claude-opus-4-8",
      isZipuClaudeRuntime: false,
    });

    expect(result.reasoningBudget).toBe("max");
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

    expect(result.reasoningBudget).toBe("max");
    expect(result.enableTeaming).toBe(true);
    expect(result.subagentModel).toBe("claude-sonnet-5");
  });

  it("selects a model-supported maximum instead of forcing xhigh globally", () => {
    const resolveFor = (resolvedModel: string) =>
      resolveUltracode({
        ultracode: true,
        reasoningBudget: "medium",
        resolvedModel,
        isZipuClaudeRuntime: resolvedModel.startsWith("glm-"),
      }).reasoningBudget;

    expect(resolveFor("gpt-5.6-sol")).toBe("xhigh");
    expect(resolveFor("gpt-5.5-pro")).toBe("xhigh");
    expect(resolveFor("gpt-4.1")).toBeUndefined();
    expect(resolveFor("gpt-4.1-mini")).toBeUndefined();
    expect(resolveFor("gpt-future-unknown")).toBeUndefined();
    expect(resolveFor("glm-5.2")).toBe("max");
    expect(resolveFor("claude-opus-4-6")).toBe("max");
    expect(resolveFor("claude-haiku-4-5")).toBeUndefined();
    expect(resolveFor("glm-5.1")).toBeUndefined();
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
