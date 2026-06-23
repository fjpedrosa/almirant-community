import { describe, expect, it } from "bun:test";
import { INTERNAL_MCP_SKILLS, requiresInternalMcp } from "./internal-skills";

describe("requiresInternalMcp", () => {
  it("returns true for every skill in the registry", () => {
    for (const skill of INTERNAL_MCP_SKILLS) {
      expect(requiresInternalMcp(skill)).toBe(true);
    }
  });

  it("returns false for common public skills", () => {
    expect(requiresInternalMcp("implement")).toBe(false);
    expect(requiresInternalMcp("validate")).toBe(false);
    expect(requiresInternalMcp("document")).toBe(false);
    expect(requiresInternalMcp("planning")).toBe(false);
  });

  it("returns false for null/undefined/empty input", () => {
    expect(requiresInternalMcp(null)).toBe(false);
    expect(requiresInternalMcp(undefined)).toBe(false);
    expect(requiresInternalMcp("")).toBe(false);
    expect(requiresInternalMcp("   ")).toBe(false);
  });

  it("does not match unknown skills even with similar prefixes", () => {
    expect(requiresInternalMcp("feedback")).toBe(false);
    expect(requiresInternalMcp("feedback-triage-extra")).toBe(false);
    expect(requiresInternalMcp("bug-fix")).toBe(false);
  });

  it("trims whitespace before checking", () => {
    expect(requiresInternalMcp("  feedback-triage  ")).toBe(true);
  });

  // Regression: enqueueFeedbackTriageBatchJob emits jobs with skillName
  // "feedback-triage-batch" whose skill calls /mcp/internal tools
  // (get_feedback_items_for_triage_batch, apply_triage_batch_decisions).
  // If this slug drops from the registry, the runner routes the job to /mcp
  // with an mcp:read|mcp:write-only token and the agent silently completes
  // without applying any triage. See job 5badbf21 / engram bugfix #1099.
  it("includes feedback-triage-batch alongside the per-item variant", () => {
    expect(requiresInternalMcp("feedback-triage-batch")).toBe(true);
  });
});
