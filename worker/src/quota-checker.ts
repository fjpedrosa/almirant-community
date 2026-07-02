import type { ApiClient } from "./api-client.js";
import { logger } from "@almirant/config";

export interface QuotaCheckResult {
  status: "allowed" | "quota_exceeded";
  reason?: string;
  periodEnd?: string;
}

/**
 * Map worker provider names to the quota provider identifiers used by the backend.
 */
const mapProviderForQuota = (provider: string): string => {
  if (provider === "claude-code") return "anthropic";
  if (provider === "codex") return "openai";
  return provider;
};

/**
 * Check whether the workspace's quota allows executing a job for the given provider.
 *
 * This is a **fail-open** check: if the quota service is unreachable or returns an error,
 * the job is allowed to proceed. Only an explicit `allowed: false` response will block execution.
 */
export const checkQuotaAvailability = async (
  apiClient: ApiClient,
  provider: string
): Promise<QuotaCheckResult> => {
  const mappedProvider = mapProviderForQuota(provider);

  try {
    const result = await apiClient.checkQuota(mappedProvider);

    if (!result.allowed) {
      return {
        status: "quota_exceeded",
        reason: result.reason,
        periodEnd: result.periodEnd,
      };
    }

    return { status: "allowed" };
  } catch (err) {
    // Fail-open: any error (network timeout, 5xx, auth issue) allows the job to proceed.
    logger.debug(
      { provider, mappedProvider, err },
      "Quota check failed, allowing job to proceed (fail-open)"
    );
    return { status: "allowed" };
  }
};
