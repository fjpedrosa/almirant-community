import { describe, expect, test } from "bun:test";
import { calculateCostUsd } from "../../billing/quota/services/ai-model-pricing";
import { deriveJobUsageMetrics } from "./job-usage-metrics";

const reportedEvidence = {
  schemaVersion: "runtime-evidence-v1",
  usage: {
    status: "reported",
    source: "terminal_aggregate",
    inputTokens: 120,
    outputTokens: 30,
    cacheReadTokens: 7,
    reasoningTokens: 5,
    totalTokens: 177,
    cost: {
      totalUsd: 0.123456789,
      detail: { input: 0.02, output: 0.103456789 },
    },
  },
} as const;

describe("deriveJobUsageMetrics", () => {
  test("uses exact reported totals without recomputing or estimating", () => {
    expect(
      deriveJobUsageMetrics({
        runtimeEvidence: reportedEvidence,
        model: "gpt-5.4",
        tokensUsed: 999,
        inputTokens: 999,
        outputTokens: 999,
        cost: 999,
        isLegacyRuntime: false,
        codingAgent: "pi",
      }),
    ).toEqual({
      tokensUsed: 177,
      cost: 0.123456789,
    });
  });

  test("omits compatibility metrics for authoritative unavailable evidence", () => {
    expect(
      deriveJobUsageMetrics({
        runtimeEvidence: {
          schemaVersion: "runtime-evidence-v1",
          usage: { status: "unavailable", reason: "not_reported" },
        },
        model: "gpt-5.4",
        tokensUsed: 999,
        inputTokens: 999,
        outputTokens: 999,
        cost: 999,
        isLegacyRuntime: false,
        codingAgent: "pi",
      }),
    ).toEqual({});
  });

  test("retains legacy split-token estimation for existing compatible agents", () => {
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
        isLegacyRuntime: true,
        codingAgent: "codex",
      }),
    ).toEqual({
      tokensUsed: 1_500_000,
      cost: expectedCost!,
    });
  });

  test("never estimates missing cost for modern or unsupported no-evidence runtimes", () => {
    expect(
      deriveJobUsageMetrics({
        model: "gpt-5.4",
        inputTokens: 10,
        outputTokens: 5,
        isLegacyRuntime: false,
        codingAgent: "pi",
      }),
    ).toEqual({ tokensUsed: 15 });

    expect(
      deriveJobUsageMetrics({
        model: "gpt-5.4",
        inputTokens: 10,
        outputTokens: 5,
        isLegacyRuntime: true,
        codingAgent: "pi",
      }),
    ).toEqual({ tokensUsed: 15 });
  });

  test("preserves explicit cost sent by a legacy compatible runner", () => {
    expect(
      deriveJobUsageMetrics({
        model: "gpt-5.4",
        inputTokens: 120,
        outputTokens: 30,
        cost: 0.123456,
        isLegacyRuntime: true,
        codingAgent: "opencode",
      }),
    ).toEqual({
      tokensUsed: 150,
      cost: 0.123456,
    });
  });

  test("keeps derived tokens even when a legacy model cannot be priced", () => {
    expect(
      deriveJobUsageMetrics({
        model: "totally-unknown-model",
        inputTokens: 10,
        outputTokens: 5,
        isLegacyRuntime: true,
        codingAgent: "claude-code",
      }),
    ).toEqual({
      tokensUsed: 15,
    });
  });
});
