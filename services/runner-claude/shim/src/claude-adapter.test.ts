import { describe, test, expect } from "bun:test";
import { resolveClaudeEffortLevel } from "./claude-adapter.js";

// The Claude CLI receives `--effort <level>` derived from REASONING_BUDGET.
// Some models (Claude Haiku 4.5) reject the effort parameter at the API level,
// so the flag must be dropped for them. resolveClaudeEffortLevel encapsulates
// that gating on top of the existing normalization.
describe("resolveClaudeEffortLevel", () => {
  test("passes the normalized effort through for an effort-capable model", () => {
    expect(resolveClaudeEffortLevel("claude-opus-4-8", "xhigh")).toBe("xhigh");
    expect(resolveClaudeEffortLevel("claude-sonnet-5", "high")).toBe("high");
  });

  test("preserves normalization semantics (max stays, aliases map to low)", () => {
    expect(resolveClaudeEffortLevel("claude-opus-4-8", "max")).toBe("max");
    expect(resolveClaudeEffortLevel("claude-opus-4-8", "minimal")).toBe("low");
    expect(resolveClaudeEffortLevel("claude-opus-4-8", "none")).toBe("low");
  });

  test("drops effort for the Claude Haiku family (rejects --effort)", () => {
    expect(resolveClaudeEffortLevel("claude-haiku-4-5", "xhigh")).toBeUndefined();
    expect(
      resolveClaudeEffortLevel("claude-haiku-4-5-20251001", "high"),
    ).toBeUndefined();
  });

  test("returns undefined when no reasoning budget is set", () => {
    expect(resolveClaudeEffortLevel("claude-opus-4-8", undefined)).toBeUndefined();
    expect(resolveClaudeEffortLevel("claude-haiku-4-5", undefined)).toBeUndefined();
    expect(resolveClaudeEffortLevel("claude-opus-4-8", "")).toBeUndefined();
  });

  test("passes effort through when the model is unknown", () => {
    // We cannot prove an unknown model lacks effort support, so don't strip it.
    expect(resolveClaudeEffortLevel(undefined, "high")).toBe("high");
  });
});
