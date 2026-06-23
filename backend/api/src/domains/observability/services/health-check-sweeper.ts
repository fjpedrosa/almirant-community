import { runHealthChecks } from "./health-checker";
import { cleanOldHealthRecords } from "@almirant/database";
import { logger } from "@almirant/config";

type HealthCheckSweeperConfig = {
  intervalMs?: number;
  retentionHours?: number;
};

/**
 * Single sweep: run all health checks and clean old records.
 */
export const runHealthCheckSweeperOnce = async (
  cfg?: HealthCheckSweeperConfig
): Promise<void> => {
  const retentionHours = cfg?.retentionHours ?? 168; // 7 days

  const results = await runHealthChecks();

  logger.info(
    {
      checks: results.map((r) => ({
        service: r.serviceName,
        status: r.status,
        latencyMs: r.latencyMs,
      })),
    },
    "[health-check-sweeper] Health checks completed"
  );

  // Clean records older than the retention window
  const deleted = await cleanOldHealthRecords(retentionHours);
  if (deleted > 0) {
    logger.info(
      { deleted, retentionHours },
      "[health-check-sweeper] Cleaned old health records"
    );
  }
};

/**
 * Starts the health check sweeper as a background service.
 * Returns a stop function for graceful shutdown.
 */
export const startHealthCheckSweeper = (
  cfg?: HealthCheckSweeperConfig
): (() => void) => {
  const intervalMs = cfg?.intervalMs ?? 300_000; // 5 minutes

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runHealthCheckSweeperOnce(cfg);
    } catch (err) {
      logger.error(
        { err },
        "[health-check-sweeper] Tick failed (transient error, will retry next interval)"
      );
    } finally {
      running = false;
    }
  };

  // Run once shortly after boot (but don't block startup).
  setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), intervalMs);

  logger.info(
    { intervalMs },
    "[health-check-sweeper] Background sweeper started"
  );

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    logger.info("[health-check-sweeper] Background sweeper stopped");
  };
};
