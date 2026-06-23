import { describe, expect, test } from "bun:test";
import { calculateCostUsd } from "../../billing/quota/services/ai-model-pricing";
import { deriveJobUsageMetrics } from "./job-usage-metrics";

describe("deriveJobUsageMetrics", () => {
  test("derives tokensUsed from split usage and estimates cost from the model", () => {
    const expectedCost = calculateCostUsd({
      provider: "openai",
      model: "gpt-5.4",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    expect(
      deriveJobUsageMetrics({
        model: "gpt-5.4",
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      }),
    ).toEqual({
      tokensUsed: 1_500_000,
      cost: expectedCost!,
    });
  });

  test("preserves explicit cost sent by the runner", () => {
    expect(
      deriveJobUsageMetrics({
        model: "gpt-5.4",
        inputTokens: 120,
        outputTokens: 30,
        cost: 0.123456,
      }),
    ).toEqual({
      tokensUsed: 150,
      cost: 0.123456,
    });
  });

  test("keeps derived tokens even when the model cannot be priced", () => {
    expect(
      deriveJobUsageMetrics({
        model: "totally-unknown-model",
        inputTokens: 10,
        outputTokens: 5,
      }),
    ).toEqual({
      tokensUsed: 15,
    });
  });
});
