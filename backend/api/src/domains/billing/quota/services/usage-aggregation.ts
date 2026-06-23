import { logger } from "@almirant/config";
import {
  db,
  usageRecords,
  and,
  gte,
  lt,
  aggregateUsageForPeriod,
  aggregateUserUsageForPeriod,
} from "@almirant/database";

type UsageAggregationConfig = {
  /** Interval between aggregation runs (ms). Default: 600 000 (10 min) */
  intervalMs?: number;
};

// Get all distinct org IDs that have usage records in the current month
const getActiveOrganizations = async (period: string): Promise<string[]> => {
  const [year, month] = period.split("-").map(Number);
  const startDate = new Date(Date.UTC(year!, month! - 1, 1));
  const endDate = new Date(Date.UTC(year!, month!, 1));

  const rows = await db
    .selectDistinct({ organizationId: usageRecords.organizationId })
    .from(usageRecords)
    .where(
      and(
        gte(usageRecords.startedAt, startDate),
        lt(usageRecords.startedAt, endDate)
      )
    );

  return rows.map((r) => r.organizationId);
};

export const runUsageAggregationOnce = async (): Promise<void> => {
  try {
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    const orgIds = await getActiveOrganizations(period);

    for (const orgId of orgIds) {
      await aggregateUsageForPeriod(orgId, period);
      await aggregateUserUsageForPeriod(orgId, period);
    }

    if (orgIds.length > 0) {
      logger.debug(
        { orgCount: orgIds.length, period },
        "usage-aggregation: summaries updated"
      );
    }
  } catch (err) {
    logger.error({ err }, "usage-aggregation: failed");
  }
};

export const startUsageAggregation = (
  config?: UsageAggregationConfig
): (() => void) => {
  const intervalMs = config?.intervalMs ?? 600_000;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runUsageAggregationOnce();
    } catch (err) {
      logger.error({ err }, "usage-aggregation: tick failed");
    } finally {
      running = false;
    }
  };

  // Run once shortly after boot (but don't block startup).
  setTimeout(() => void tick(), 30_000);
  timer = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
};
