import { logger } from "@almirant/config";
import {
  db,
  quotaUsagePeriods,
  eq,
  and,
  computePeriodBounds,
  getOrCreateUsagePeriod,
} from "@almirant/database";
import { anthropicUsageClient } from "./anthropic-usage-client";
import { quotaService } from "./quota-service-instance";
import { getWorkspaceIdsWithActiveQuotas } from "@almirant/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UsageReconciliationConfig = {
  /** Interval between reconciliation runs (ms). Default: 300 000 (5 min) */
  intervalMs?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date as YYYY-MM-DD in UTC */
const formatDateUTC = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** Minimum threshold for discrepancy correction (5%) */
const DISCREPANCY_THRESHOLD = 0.05;

// ---------------------------------------------------------------------------
// Single reconciliation run
// ---------------------------------------------------------------------------

export const runUsageReconciliationOnce = async (
  _config?: UsageReconciliationConfig
): Promise<void> => {
  // Gracefully skip if the Admin API key is not configured
  if (!anthropicUsageClient.isConfigured()) {
    return;
  }

  try {
    // 1. Compute the current daily period bounds
    const { start: periodStart, end: periodEnd } = computePeriodBounds("daily");

    const startDate = formatDateUTC(periodStart);
    const endDate = formatDateUTC(periodEnd);

    // 2. Query the Anthropic Admin API for today's message usage
    const report = await anthropicUsageClient.getMessageUsageReport({
      startDate,
      endDate,
      bucketWidth: "day",
    });

    // 3. Sum total tokens from the API response
    let apiInputTokens = 0;
    let apiOutputTokens = 0;

    for (const bucket of report.data) {
      apiInputTokens += bucket.input_tokens + bucket.input_cached_tokens;
      apiOutputTokens += bucket.output_tokens + bucket.output_cached_tokens;
    }

    const apiTotalTokens = apiInputTokens + apiOutputTokens;

    // 4. Get our internal usage for the current daily period
    //    Ensure the usage row exists so we have something to compare against
    const usagePeriod = await getOrCreateUsagePeriod("anthropic", "daily");
    const internalTokens = usagePeriod.totalTokens;

    // 5. Compute discrepancy
    //    Use the larger value as the denominator to avoid division by zero edge cases
    const maxTokens = Math.max(apiTotalTokens, internalTokens);

    if (maxTokens === 0) {
      // Both are zero -- nothing to reconcile
      return;
    }

    const discrepancyAbs = Math.abs(apiTotalTokens - internalTokens);
    const discrepancyPercent = discrepancyAbs / maxTokens;

    // 6. If discrepancy exceeds threshold, correct internal data
    if (discrepancyPercent > DISCREPANCY_THRESHOLD) {
      logger.warn(
        {
          internalTokens,
          apiTokens: apiTotalTokens,
          discrepancyPercent: Math.round(discrepancyPercent * 10000) / 100,
          periodStart: startDate,
        },
        "usage-reconciliation: token discrepancy detected, correcting internal data"
      );

      await db
        .update(quotaUsagePeriods)
        .set({
          totalTokens: apiTotalTokens,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(quotaUsagePeriods.provider, "anthropic"),
            eq(quotaUsagePeriods.periodType, "daily"),
            eq(quotaUsagePeriods.periodStart, periodStart)
          )
        );
      // Evaluate quota alerts for all workspaces with active anthropic quotas
      const orgIds = await getWorkspaceIdsWithActiveQuotas("anthropic");
      for (const orgId of orgIds) {
        quotaService.evaluateAlerts(orgId, "anthropic").catch((alertErr) => {
          logger.warn({ orgId, err: alertErr }, "usage-reconciliation: failed to evaluate alerts after correction");
        });
      }
    } else {
      logger.debug(
        {
          internalTokens,
          apiTokens: apiTotalTokens,
          discrepancyPercent: Math.round(discrepancyPercent * 10000) / 100,
        },
        "usage-reconciliation: tokens within acceptable range"
      );
    }
  } catch (err) {
    logger.error(
      { err },
      "usage-reconciliation: failed to reconcile usage"
    );
  }
};

// ---------------------------------------------------------------------------
// Interval-based background service
// ---------------------------------------------------------------------------

export const startUsageReconciliation = (
  config?: UsageReconciliationConfig
): (() => void) => {
  const intervalMs = config?.intervalMs ?? 300_000;

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runUsageReconciliationOnce(config);
    } catch (err) {
      logger.error(
        { err },
        "Usage reconciliation: tick failed (transient DB error, will retry next interval)"
      );
    } finally {
      running = false;
    }
  };

  // Run once shortly after boot (but don't block startup).
  setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
};
