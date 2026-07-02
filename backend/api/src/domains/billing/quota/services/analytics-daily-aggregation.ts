import { logger } from "@almirant/config";
import {
  db,
  agentJobs,
  and,
  gte,
  lt,
  sql,
  aggregateUsageForPeriod,
  aggregateUserUsageForPeriod,
} from "@almirant/database";

type AnalyticsDailyAggregationConfig = {
  /** Interval between aggregation runs (ms). Default: 3 600 000 (1 hour) */
  intervalMs?: number;
};

/**
 * Get all distinct workspace+period pairs that have agent_jobs in the last N days.
 * Usage summaries are monthly, so we aggregate by YYYY-MM period.
 */
const getPeriodsWithActivity = async (
  days: number
): Promise<Array<{ workspaceId: string; period: string }>> => {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  // Get distinct dates (YYYY-MM-DD) that have agent jobs, excluding today
  const todayStr = now.toISOString().slice(0, 10);
  const todayStart = new Date(`${todayStr}T00:00:00.000Z`);

  const rows = await db
    .selectDistinct({
      workspaceId: agentJobs.workspaceId,
      period: sql<string>`to_char(${agentJobs.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`,
    })
    .from(agentJobs)
    .where(
      and(
        gte(agentJobs.createdAt, cutoff),
        lt(agentJobs.createdAt, todayStart),
        sql`${agentJobs.workspaceId} is not null`
      )
    );

  return rows.flatMap((row) =>
    row.workspaceId
      ? [{ workspaceId: row.workspaceId, period: row.period }]
      : [],
  );
};

/**
 * Run a single pass of the daily analytics aggregation.
 *
 * Looks back 7 days (catch-up window) and aggregates each monthly period
 * that had activity. The current (incomplete) day is always skipped.
 */
export const runAnalyticsDailyAggregationOnce = async (): Promise<void> => {
  try {
    const periods = await getPeriodsWithActivity(7);

    for (const { workspaceId, period } of periods) {
      await aggregateUsageForPeriod(workspaceId, period);
      await aggregateUserUsageForPeriod(workspaceId, period);
    }

    if (periods.length > 0) {
      logger.debug(
        { periodCount: periods.length, periods },
        "analytics-daily-aggregation: summaries updated"
      );
    }
  } catch (err) {
    logger.error({ err }, "analytics-daily-aggregation: failed");
  }
};

/**
 * Start the daily analytics aggregation sweeper.
 *
 * Runs once 30 seconds after boot, then repeats at the configured interval
 * (default: 1 hour). Returns a stop function for graceful shutdown.
 */
export const startAnalyticsDailyAggregation = (
  config?: AnalyticsDailyAggregationConfig
): (() => void) => {
  const intervalMs = config?.intervalMs ?? 3_600_000;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runAnalyticsDailyAggregationOnce();
    } catch (err) {
      logger.error({ err }, "analytics-daily-aggregation: tick failed");
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
