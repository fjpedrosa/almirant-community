import { deleteAgentJobLogsBeforeTimestamp } from "@almirant/database";
import { logger } from "@almirant/config";

type AgentJobLogsSweeperConfig = {
  intervalMs?: number;
  retentionDays?: number;
  batchSize?: number;
};

export type AgentJobLogsSweeperDeps = {
  deleteAgentJobLogsBeforeTimestamp: (
    before: Date,
    limit: number
  ) => Promise<number>;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
};

type AgentJobLogsSweeperStats = {
  rowsDeleted: number;
  durationMs: number;
  lastRunAt: string;
};

const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 30;
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 1_000;
const MIN_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 5_000;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const resolveRetentionDays = (value: number | undefined): number => {
  const fallback = value ?? DEFAULT_RETENTION_DAYS;
  return clamp(Math.floor(fallback), MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
};

const resolveBatchSize = (value: number | undefined): number => {
  const fallback = value ?? DEFAULT_BATCH_SIZE;
  return clamp(Math.floor(fallback), MIN_BATCH_SIZE, MAX_BATCH_SIZE);
};

export const runAgentJobLogsSweeperOnce = async (
  cfg?: AgentJobLogsSweeperConfig,
  depsOverride?: AgentJobLogsSweeperDeps
): Promise<AgentJobLogsSweeperStats> => {
  const deps: AgentJobLogsSweeperDeps = depsOverride ?? {
    deleteAgentJobLogsBeforeTimestamp,
    logger,
  };
  const startedAt = Date.now();
  const retentionDays = resolveRetentionDays(cfg?.retentionDays);
  const batchSize = resolveBatchSize(cfg?.batchSize);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  let rowsDeleted = 0;

  while (true) {
    const deletedInBatch = await deps.deleteAgentJobLogsBeforeTimestamp(cutoff, batchSize);
    rowsDeleted += deletedInBatch;
    if (deletedInBatch < batchSize) break;
  }

  const durationMs = Date.now() - startedAt;
  const lastRunAt = new Date().toISOString();

  deps.logger.info(
    {
      rowsDeleted,
      durationMs,
      lastRunAt,
      retentionDays,
      cutoff: cutoff.toISOString(),
      batchSize,
    },
    "[agent-job-logs-sweeper] Sweep completed"
  );

  return {
    rowsDeleted,
    durationMs,
    lastRunAt,
  };
};

export const startAgentJobLogsSweeper = (cfg?: AgentJobLogsSweeperConfig): (() => void) => {
  const intervalMs = Math.max(15_000, Math.floor(cfg?.intervalMs ?? DEFAULT_INTERVAL_MS));
  const retentionDays = resolveRetentionDays(cfg?.retentionDays);
  const batchSize = resolveBatchSize(cfg?.batchSize);

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runAgentJobLogsSweeperOnce({ intervalMs, retentionDays, batchSize });
    } catch (err) {
      logger.error({ err }, "[agent-job-logs-sweeper] Unhandled error in sweep tick");
    } finally {
      running = false;
    }
  };

  setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), intervalMs);

  logger.info(
    { intervalMs, retentionDays, batchSize },
    "[agent-job-logs-sweeper] Background sweeper started"
  );

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    logger.info("[agent-job-logs-sweeper] Background sweeper stopped");
  };
};
