import { calculateCostUsd } from "../../billing/quota/services/ai-model-pricing";

export type JobUsageMetricsInput = {
  model?: string | null;
  cost?: number | null;
  tokensUsed?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

export type JobUsageMetrics = {
  cost?: number;
  tokensUsed?: number;
};

const PRICING_PROVIDERS = ["anthropic", "openai", "zai", "xai"] as const;

const asNumber = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
};

const normalizeModel = (value: string | null | undefined): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const deriveJobUsageMetrics = (
  input: JobUsageMetricsInput,
): JobUsageMetrics => {
  const model = normalizeModel(input.model);
  const inputTokens = asNumber(input.inputTokens);
  const outputTokens = asNumber(input.outputTokens);
  const explicitTokensUsed = asNumber(input.tokensUsed);
  const explicitCost = asNumber(input.cost);

  const hasSplitUsage = inputTokens !== undefined || outputTokens !== undefined;
  const derivedTokensUsed = hasSplitUsage
    ? (inputTokens ?? 0) + (outputTokens ?? 0)
    : explicitTokensUsed;

  if (explicitCost !== undefined) {
    return {
      ...(derivedTokensUsed !== undefined ? { tokensUsed: derivedTokensUsed } : {}),
      cost: explicitCost,
    };
  }

  if (!model || inputTokens === undefined || outputTokens === undefined) {
    return derivedTokensUsed !== undefined ? { tokensUsed: derivedTokensUsed } : {};
  }

  for (const provider of PRICING_PROVIDERS) {
    const estimatedCost = calculateCostUsd({
      provider,
      model,
      inputTokens,
      outputTokens,
    });
    if (estimatedCost !== null) {
      return {
        tokensUsed: derivedTokensUsed,
        cost: estimatedCost,
      };
    }
  }

  return derivedTokensUsed !== undefined ? { tokensUsed: derivedTokensUsed } : {};
};
