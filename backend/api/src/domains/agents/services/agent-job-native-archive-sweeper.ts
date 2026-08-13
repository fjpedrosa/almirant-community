import {
  deleteAgentNativeEventsByJobId,
  getAgentJobEventArchive,
  getAgentJobsEligibleForNativeArchive,
  getAgentNativeEventsByJobId,
  upsertAgentJobEventArchive,
  type AgentJobEventArchiveDb,
  type AgentJobNativeArchiveCandidate,
  type AgentNativeEventDb,
} from "@almirant/database";
import { logger } from "@almirant/config";
import {
  AGENT_JOB_ARCHIVE_KIND,
  uploadAgentJobNativeEventsArchivePages,
  type UploadedAgentJobArchive,
} from "./agent-job-archive-storage";

type AgentJobNativeArchiveSweeperConfig = {
  intervalMs?: number;
  retentionDays?: number;
  jobBatchSize?: number;
  eventPageSize?: number;
};

export type AgentJobNativeArchiveSweeperDeps = {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  getAgentJobsEligibleForNativeArchive: (
    before: Date,
    limit: number,
  ) => Promise<AgentJobNativeArchiveCandidate[]>;
  getAgentJobEventArchive: (
    agentJobId: string,
    archiveKind: string,
  ) => Promise<AgentJobEventArchiveDb | null>;
  getAgentNativeEventsByJobId: (
    agentJobId: string,
    filters?: { limit?: number; afterSequence?: number },
  ) => Promise<AgentNativeEventDb[]>;
  uploadAgentJobNativeEventsArchive: (
    agentJobId: string,
    pages: AsyncIterable<AgentNativeEventDb[]>,
    workspaceId: string | null,
  ) => Promise<UploadedAgentJobArchive | null>;
  upsertAgentJobEventArchive: typeof upsertAgentJobEventArchive;
  deleteAgentNativeEventsByJobId: (agentJobId: string) => Promise<number>;
};

type AgentJobNativeArchiveSweeperStats = {
  jobsScanned: number;
  archivesCreated: number;
  rowsDeleted: number;
  failures: number;
  durationMs: number;
  lastRunAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_JOB_BATCH_SIZE = 25;
const DEFAULT_EVENT_PAGE_SIZE = 1000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const streamNativeEventPages = async function* (
  agentJobId: string,
  eventPageSize: number,
  deps: AgentJobNativeArchiveSweeperDeps,
): AsyncGenerator<AgentNativeEventDb[]> {
  let afterSequence: number | undefined;

  while (true) {
    const batch = await deps.getAgentNativeEventsByJobId(agentJobId, {
      limit: eventPageSize,
      ...(afterSequence !== undefined ? { afterSequence } : {}),
    });

    if (batch.length === 0) break;
    yield batch;
    afterSequence = batch[batch.length - 1]!.sequenceNum;
    if (batch.length < eventPageSize) break;
  }
};

export const runAgentJobNativeArchiveSweeperOnce = async (
  cfg?: AgentJobNativeArchiveSweeperConfig,
  depsOverride?: AgentJobNativeArchiveSweeperDeps,
): Promise<AgentJobNativeArchiveSweeperStats> => {
  const deps: AgentJobNativeArchiveSweeperDeps = depsOverride ?? {
    logger,
    getAgentJobsEligibleForNativeArchive,
    getAgentJobEventArchive,
    getAgentNativeEventsByJobId,
    uploadAgentJobNativeEventsArchive: uploadAgentJobNativeEventsArchivePages,
    upsertAgentJobEventArchive,
    deleteAgentNativeEventsByJobId,
  };

  const startedAt = Date.now();
  const retentionDays = clamp(Math.floor(cfg?.retentionDays ?? DEFAULT_RETENTION_DAYS), 1, 365);
  const jobBatchSize = clamp(Math.floor(cfg?.jobBatchSize ?? DEFAULT_JOB_BATCH_SIZE), 1, 200);
  const eventPageSize = clamp(
    Math.floor(cfg?.eventPageSize ?? DEFAULT_EVENT_PAGE_SIZE),
    100,
    5000,
  );
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS);

  const stats: AgentJobNativeArchiveSweeperStats = {
    jobsScanned: 0,
    archivesCreated: 0,
    rowsDeleted: 0,
    failures: 0,
    durationMs: 0,
    lastRunAt: new Date().toISOString(),
  };

  const jobs = await deps.getAgentJobsEligibleForNativeArchive(cutoff, jobBatchSize);
  stats.jobsScanned = jobs.length;

  for (const job of jobs) {
    try {
      const existing = await deps.getAgentJobEventArchive(
        job.id,
        AGENT_JOB_ARCHIVE_KIND.nativeEvents,
      );

      if (!existing) {
        const pages = streamNativeEventPages(job.id, eventPageSize, deps);
        const uploaded = await deps.uploadAgentJobNativeEventsArchive(job.id, pages, job.workspaceId);
        if (uploaded === null || uploaded.rowCount === 0) continue;
        await deps.upsertAgentJobEventArchive({
          agentJobId: job.id,
          archiveKind: AGENT_JOB_ARCHIVE_KIND.nativeEvents,
          storageBucket: uploaded.storageBucket ?? undefined,
          storageKey: uploaded.storageKey,
          storageUrl: uploaded.storageUrl ?? undefined,
          format: uploaded.format,
          compression: uploaded.compression,
          contentType: uploaded.contentType,
          rowCount: uploaded.rowCount,
          lastSequenceNum: uploaded.lastSequenceNum ?? undefined,
          checksumSha256: uploaded.checksumSha256,
        });
        stats.archivesCreated += 1;
      }

      stats.rowsDeleted += await deps.deleteAgentNativeEventsByJobId(job.id);
    } catch (err) {
      stats.failures += 1;
      deps.logger.error(
        { err, agentJobId: job.id },
        "[agent-job-native-archive-sweeper] Failed to archive job native events",
      );
    }
  }

  stats.durationMs = Date.now() - startedAt;

  if (stats.jobsScanned > 0) {
    deps.logger.info(stats, "[agent-job-native-archive-sweeper] Sweep completed");
  }

  return stats;
};

export const startAgentJobNativeArchiveSweeper = (
  cfg?: AgentJobNativeArchiveSweeperConfig,
): (() => void) => {
  const intervalMs = Math.max(30_000, Math.floor(cfg?.intervalMs ?? DEFAULT_INTERVAL_MS));

  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runAgentJobNativeArchiveSweeperOnce(cfg);
    } catch (err) {
      logger.error({ err }, "[agent-job-native-archive-sweeper] Unhandled error in sweep tick");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  logger.info({ intervalMs }, "[agent-job-native-archive-sweeper] Background sweeper started");

  return () => {
    stopped = true;
    clearInterval(timer);
  };
};
