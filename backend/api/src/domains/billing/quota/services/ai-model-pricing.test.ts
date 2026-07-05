import { describe, expect, it } from "bun:test";
import { calculateCostUsd } from "./ai-model-pricing";

describe("calculateCostUsd", () => {
  it("calculates OpenAI GPT-4o cost", () => {
    const cost = calculateCostUsd({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(12.5);
  });

  it("calculates OpenAI o3-mini cost", () => {
    const cost = calculateCostUsd({
      provider: "openai",
      model: "o3-mini",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(5.5);
  });

  it("calculates OpenAI GPT-5.5 cost", () => {
    const cost = calculateCostUsd({
      provider: "openai",
      model: "gpt-5.5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(35);
  });

  it("calculates OpenAI GPT-5.5 Pro cost", () => {
    const cost = calculateCostUsd({
      provider: "openai",
      model: "gpt-5.5-pro",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(210);
  });

  it("calculates Anthropic Claude Fable 5 cost", () => {
    const cost = calculateCostUsd({
      provider: "anthropic",
      model: "claude-fable-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // 10 + 50 = 60
    expect(cost).toBe(60);
  });

  it("calculates Anthropic Opus 4.8 cost", () => {
    const cost = calculateCostUsd({
      provider: "anthropic",
      model: "claude-opus-4-8",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // 5 + 25 = 30
    expect(cost).toBe(30);
  });

  it("resolves Opus 4.8 snapshot ids before the legacy Opus 4 catch-all matcher", () => {
    // The legacy "claude-opus-4" entry matches m.includes("claude-opus-4-"), which would
    // capture opus-4-8 snapshots at $15/$75 if it ran first. Order of matchers matters.
    const cost = calculateCostUsd({
      provider: "anthropic",
      model: "claude-opus-4-8-20260601",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // 5 + 25 = 30 (NOT 15 + 75 = 90 from the catch-all)
    expect(cost).toBe(30);
  });

  it("keeps legacy Claude Opus 4 snapshots on the catch-all price", () => {
    const cost = calculateCostUsd({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // 15 + 75 = 90
    expect(cost).toBe(90);
  });

  it("calculates Anthropic Claude Sonnet 5 cost at list price", () => {
    const cost = calculateCostUsd({
      provider: "anthropic",
      model: "claude-sonnet-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // List price: 3 + 15 = 18 (intro pricing intentionally not modeled)
    expect(cost).toBe(18);
  });

  it("calculates Anthropic Sonnet 4.5 cost from snapshot ids", () => {
    const cost = calculateCostUsd({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
    });
    // 3 + 30 = 33
    expect(cost).toBe(33);
  });

  it("calculates Z.AI GLM-5 cost", () => {
    const cost = calculateCostUsd({
      provider: "zai",
      model: "glm-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(4.2);
  });

  it("maps openai-compatible GLM models to Z.AI pricing", () => {
    const cost = calculateCostUsd({
      provider: "zai",
      model: "glm-5.2-250828",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // glm-5.2 snapshot id fuzzy-matches the base glm-5.2 pricing: 1.4 + 4.4 = 5.8
    expect(cost).toBe(5.8);
  });

  it("supports free GLM flash models", () => {
    const cost = calculateCostUsd({
      provider: "zai",
      model: "glm-4.7-flash",
      inputTokens: 2_000_000,
      outputTokens: 2_000_000,
    });
    expect(cost).toBe(0);
  });

  it("supports legacy GLM-Z1 aliases", () => {
    const cost = calculateCostUsd({
      provider: "zai",
      model: "glm-z1-air",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(1.2);
  });

  it("includes Anthropic cache read cost at 10% of input rate", () => {
    // Anthropic Sonnet 5: input $3/MTok. Cache read = $3 * 0.1 = $0.30 / MTok.
    const cost = calculateCostUsd({
      provider: "anthropic",
      model: "claude-sonnet-5",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });
    // Base input: 3, Cache read: 0.30 → 3.30
    expect(cost).toBe(3.3);
  });

  it("includes Anthropic cache creation cost at 125% of input rate", () => {
    // Anthropic Sonnet 5: input $3/MTok. Cache creation = $3 * 1.25 = $3.75 / MTok.
    const cost = calculateCostUsd({
      provider: "anthropic",
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
    });
    expect(cost).toBe(3.75);
  });

  it("combines all token types correctly for Anthropic Opus 4.7", () => {
    // Opus 4.7: input $5, output $25. Cache read $0.5, cache creation $6.25.
    const cost = calculateCostUsd({
      provider: "anthropic",
      model: "claude-opus-4-7",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadInputTokens: 2_000_000,
      cacheCreationInputTokens: 500_000,
    });
    // 5 + 25 + (2 * 0.5) + (0.5 * 6.25) = 5 + 25 + 1 + 3.125 = 34.125
    expect(cost).toBe(34.125);
  });

  it("treats undefined cache tokens as zero (backward compat)", () => {
    const costNoCache = calculateCostUsd({
      provider: "anthropic",
      model: "claude-sonnet-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    const costExplicitZero = calculateCostUsd({
      provider: "anthropic",
      model: "claude-sonnet-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    expect(costNoCache).toBe(costExplicitZero);
  });

  it("returns null for unknown model/provider pairs", () => {
    const cost = calculateCostUsd({
      provider: "openai",
      model: "totally-unknown",
      inputTokens: 100,
      outputTokens: 200,
    });
    expect(cost).toBeNull();
  });
});
