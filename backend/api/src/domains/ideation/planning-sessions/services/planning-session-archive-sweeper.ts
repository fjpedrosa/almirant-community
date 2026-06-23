import type {
  AgentNativeEventDb,
  EventArchiveDb,
  PlanningSessionArchiveCandidate,
  PlanningSessionWithMeta,
  SessionEventDb,
  SessionSnapshotDb,
} from "@almirant/database";
import {
  deleteAgentNativeEventsBySessionId,
  deleteSessionEventsBySessionId,
  getAgentNativeEventsBySessionId,
  getEventArchiveBySessionAndKind,
  getLatestJobForPlanningSession,
  getPlanningSessionById,
  getPlanningSessionUserInputs,
  getPlanningSessionsEligibleForArchive,
  getSessionEventsBySessionId,
  getSessionSnapshot,
  upsertEventArchive,
  upsertSessionSnapshot,
} from "@almirant/database";
import { logger } from "@almirant/config";
import {
  buildPlanningSessionBootstrap,
  PLANNING_BOOTSTRAP_PROJECTOR_VERSION,
} from "./planning-session-bootstrap";
import {
  PLANNING_SESSION_ARCHIVE_KIND,
  isPlanningSessionArchiveConfigured,
  uploadCanonicalEventsArchive,
  uploadNativeEventsArchive,
  uploadSessionSnapshotArchive,
} from "./planning-session-archive-storage";

type PlanningSessionArchiveSweeperConfig = {
  intervalMs?: number;
  nativeRetentionDays?: number;
  canonicalRetentionDays?: number;
  sessionBatchSize?: number;
  eventPageSize?: number;
};

type PlanningSessionArchiveSweeperStats = {
  sessionsScanned: number;
  canonicalArchivesCreated: number;
  nativeArchivesCreated: number;
  snapshotArchivesCreated: number;
  canonicalRowsDeleted: number;
  nativeRowsDeleted: number;
  skippedNoStorage: boolean;
  durationMs: number;
  lastRunAt: string;
};

export type PlanningSessionArchiveSweeperDeps = {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  isArchiveConfigured: () => boolean;
  getPlanningSessionsEligibleForArchive: (
    before: Date,
    limit: number,
  ) => Promise<PlanningSessionArchiveCandidate[]>;
  getPlanningSessionById: (sessionId: string) => Promise<PlanningSessionWithMeta | null>;
  getSessionSnapshot: (sessionId: string) => Promise<SessionSnapshotDb | null>;
  upsertSessionSnapshot: typeof upsertSessionSnapshot;
  getLatestJobForPlanningSession: typeof getLatestJobForPlanningSession;
  getPlanningSessionUserInputs: typeof getPlanningSessionUserInputs;
  getSessionEventsBySessionId: typeof getSessionEventsBySessionId;
  getAgentNativeEventsBySessionId: typeof getAgentNativeEventsBySessionId;
  getEventArchiveBySessionAndKind: (
    sessionId: string,
    archiveKind: string,
  ) => Promise<EventArchiveDb | null>;
  upsertEventArchive: typeof upsertEventArchive;
  uploadCanonicalEventsArchive: typeof uploadCanonicalEventsArchive;
  uploadNativeEventsArchive: typeof uploadNativeEventsArchive;
  uploadSessionSnapshotArchive: typeof uploadSessionSnapshotArchive;
  deleteSessionEventsBySessionId: typeof deleteSessionEventsBySessionId;
  deleteAgentNativeEventsBySessionId: typeof deleteAgentNativeEventsBySessionId;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_NATIVE_RETENTION_DAYS = 30;
const DEFAULT_CANONICAL_RETENTION_DAYS = 90;
const DEFAULT_SESSION_BATCH_SIZE = 10;
const DEFAULT_EVENT_PAGE_SIZE = 1000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const resolveDays = (value: number | undefined, fallback: number): number =>
  clamp(Math.floor(value ?? fallback), 1, 365);

const resolveBatchSize = (value: number | undefined, fallback: number, max: number): number =>
  clamp(Math.floor(value ?? fallback), 1, max);

const resolveArchivableAt = (session: PlanningSessionArchiveCandidate): Date =>
  session.completedAt ?? session.updatedAt;

const collectCanonicalEvents = async (
  planningSessionId: string,
  eventPageSize: number,
  deps: PlanningSessionArchiveSweeperDeps,
): Promise<SessionEventDb[]> => {
  const events: SessionEventDb[] = [];
  let afterSequence: number | undefined;

  while (true) {
    const batch = await deps.getSessionEventsBySessionId(planningSessionId, {
      limit: eventPageSize,
      ...(afterSequence !== undefined ? { afterSequence } : {}),
    });

    if (batch.length === 0) break;
    events.push(...batch);
    afterSequence = batch[batch.length - 1]!.sequenceNum;
    if (batch.length < eventPageSize) break;
  }

  return events;
};

const collectNativeEvents = async (
  planningSessionId: string,
  eventPageSize: number,
  deps: PlanningSessionArchiveSweeperDeps,
): Promise<AgentNativeEventDb[]> => {
  const events: AgentNativeEventDb[] = [];
  let afterSequence: number | undefined;

  while (true) {
    const batch = await deps.getAgentNativeEventsBySessionId(planningSessionId, {
      limit: eventPageSize,
      ...(afterSequence !== undefined ? { afterSequence } : {}),
    });

    if (batch.length === 0) break;
    events.push(...batch);
    afterSequence = batch[batch.length - 1]!.sequenceNum;
    if (batch.length < eventPageSize) break;
  }

  return events;
};

const ensureCurrentSnapshot = async (
  session: PlanningSessionWithMeta,
  eventPageSize: number,
  deps: PlanningSessionArchiveSweeperDeps,
): Promise<SessionSnapshotDb | null> => {
  const existing = await deps.getSessionSnapshot(session.id);
  if (existing && existing.projectorVersion === PLANNING_BOOTSTRAP_PROJECTOR_VERSION) {
    return existing;
  }

  const [sessionEvents, userInputs, latestJob] = await Promise.all([
    collectCanonicalEvents(session.id, eventPageSize, deps),
    deps.getPlanningSessionUserInputs(session.id, { limit: 500 }),
    deps.getLatestJobForPlanningSession(session.id),
  ]);

  if (sessionEvents.length === 0) {
    return existing;
  }

  const projection = buildPlanningSessionBootstrap({
    sessionId: session.id,
    events: sessionEvents,
    userInputs,
  });

  return deps.upsertSessionSnapshot({
    planningSessionId: session.id,
    projectorVersion: PLANNING_BOOTSTRAP_PROJECTOR_VERSION,
    lastCanonicalSeq: projection.baseSeq,
    timeline: projection.checkpointState as unknown as Record<string, unknown>,
    summary: session.result as Record<string, unknown> | null | undefined,
    metrics: {
      inputTokens: session.totalInputTokens ?? 0,
      outputTokens: session.totalOutputTokens ?? 0,
      estimatedCost: session.estimatedCost,
      durationMs: session.durationMs,
      model: latestJob?.model ?? null,
    },
  });
};

const ensureSnapshotArchive = async (
  session: PlanningSessionWithMeta,
  eventPageSize: number,
  deps: PlanningSessionArchiveSweeperDeps,
): Promise<{ ready: boolean; created: boolean }> => {
  const existingArchive = await deps.getEventArchiveBySessionAndKind(
    session.id,
    PLANNING_SESSION_ARCHIVE_KIND.sessionSnapshot,
  );
  if (existingArchive) {
    return { ready: true, created: false };
  }

  const snapshot = await ensureCurrentSnapshot(session, eventPageSize, deps);
  if (!snapshot) {
    return { ready: false, created: false };
  }

  const uploaded = await deps.uploadSessionSnapshotArchive({
    planningSessionId: session.id,
    projectorVersion: snapshot.projectorVersion,
    lastCanonicalSeq: snapshot.lastCanonicalSeq,
    timeline: snapshot.timeline,
    summary: (snapshot.summary as Record<string, unknown> | null) ?? null,
    metrics: (snapshot.metrics as Record<string, unknown> | null) ?? null,
    archivedAt: new Date().toISOString(),
  });

  await deps.upsertEventArchive({
    planningSessionId: session.id,
    archiveKind: PLANNING_SESSION_ARCHIVE_KIND.sessionSnapshot,
    storageBucket: uploaded.storageBucket ?? undefined,
    storageKey: uploaded.storageKey,
    storageUrl: uploaded.storageUrl ?? undefined,
    format: uploaded.format,
    compression: uploaded.compression,
    contentType: uploaded.contentType,
    rowCount: uploaded.rowCount,
    lastSequenceNum: uploaded.lastSequenceNum ?? undefined,
    projectorVersion: uploaded.projectorVersion ?? undefined,
    checksumSha256: uploaded.checksumSha256,
  });

  return { ready: true, created: true };
};

export const runPlanningSessionArchiveSweeperOnce = async (
  cfg?: PlanningSessionArchiveSweeperConfig,
  depsOverride?: PlanningSessionArchiveSweeperDeps,
): Promise<PlanningSessionArchiveSweeperStats> => {
  const deps: PlanningSessionArchiveSweeperDeps = depsOverride ?? {
    logger,
    isArchiveConfigured: isPlanningSessionArchiveConfigured,
    getPlanningSessionsEligibleForArchive,
    getPlanningSessionById,
    getSessionSnapshot,
    upsertSessionSnapshot,
    getLatestJobForPlanningSession,
    getPlanningSessionUserInputs,
    getSessionEventsBySessionId,
    getAgentNativeEventsBySessionId,
    getEventArchiveBySessionAndKind,
    upsertEventArchive,
    uploadCanonicalEventsArchive,
    uploadNativeEventsArchive,
    uploadSessionSnapshotArchive,
    deleteSessionEventsBySessionId,
    deleteAgentNativeEventsBySessionId,
  };

  const startedAt = Date.now();
  const nativeRetentionDays = resolveDays(
    cfg?.nativeRetentionDays,
    DEFAULT_NATIVE_RETENTION_DAYS,
  );
  const canonicalRetentionDays = resolveDays(
    cfg?.canonicalRetentionDays,
    DEFAULT_CANONICAL_RETENTION_DAYS,
  );
  const sessionBatchSize = resolveBatchSize(
    cfg?.sessionBatchSize,
    DEFAULT_SESSION_BATCH_SIZE,
    100,
  );
  const eventPageSize = resolveBatchSize(
    cfg?.eventPageSize,
    DEFAULT_EVENT_PAGE_SIZE,
    10_000,
  );

  if (!deps.isArchiveConfigured()) {
    const stats = {
      sessionsScanned: 0,
      canonicalArchivesCreated: 0,
      nativeArchivesCreated: 0,
      snapshotArchivesCreated: 0,
      canonicalRowsDeleted: 0,
      nativeRowsDeleted: 0,
      skippedNoStorage: true,
      durationMs: Date.now() - startedAt,
      lastRunAt: new Date().toISOString(),
    };

    deps.logger.info(
      { nativeRetentionDays, canonicalRetentionDays },
      "[planning-session-archive-sweeper] Skipped because archive storage is not configured",
    );

    return stats;
  }

  const nativeCutoff = new Date(Date.now() - nativeRetentionDays * DAY_MS);
  const canonicalCutoff = new Date(Date.now() - canonicalRetentionDays * DAY_MS);
  const earliestCutoff = new Date(Math.min(nativeCutoff.getTime(), canonicalCutoff.getTime()));
  const sessions = await deps.getPlanningSessionsEligibleForArchive(
    earliestCutoff,
    sessionBatchSize,
  );

  const stats: PlanningSessionArchiveSweeperStats = {
    sessionsScanned: sessions.length,
    canonicalArchivesCreated: 0,
    nativeArchivesCreated: 0,
    snapshotArchivesCreated: 0,
    canonicalRowsDeleted: 0,
    nativeRowsDeleted: 0,
    skippedNoStorage: false,
    durationMs: 0,
    lastRunAt: new Date().toISOString(),
  };

  for (const candidate of sessions) {
    const archivableAt = resolveArchivableAt(candidate);
    const canonicalDue = archivableAt <= canonicalCutoff;
    const nativeDue = archivableAt <= nativeCutoff;

    if (!canonicalDue && !nativeDue) continue;

    const session = await deps.getPlanningSessionById(candidate.id);
    if (!session) continue;

    const snapshotArchiveState = await ensureSnapshotArchive(session, eventPageSize, deps);
    if (snapshotArchiveState.created) {
      stats.snapshotArchivesCreated += 1;
    }

    if (canonicalDue) {
      const existingArchive = await deps.getEventArchiveBySessionAndKind(
        session.id,
        PLANNING_SESSION_ARCHIVE_KIND.canonicalEvents,
      );
      let canDeleteCanonical = Boolean(existingArchive) && snapshotArchiveState.ready;

      if (!existingArchive) {
        if (!snapshotArchiveState.ready) {
          deps.logger.warn(
            { sessionId: session.id },
            "[planning-session-archive-sweeper] Skipping canonical purge because snapshot archive is not available",
          );
        } else {
          const events = await collectCanonicalEvents(session.id, eventPageSize, deps);
          if (events.length > 0) {
            const uploaded = await deps.uploadCanonicalEventsArchive(session.id, events);
            await deps.upsertEventArchive({
              planningSessionId: session.id,
              archiveKind: PLANNING_SESSION_ARCHIVE_KIND.canonicalEvents,
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
            stats.canonicalArchivesCreated += 1;
            canDeleteCanonical = true;
          }
        }
      }

      if (canDeleteCanonical) {
        const deleted = await deps.deleteSessionEventsBySessionId(session.id);
        stats.canonicalRowsDeleted += deleted;
      }
    }

    if (nativeDue) {
      const existingArchive = await deps.getEventArchiveBySessionAndKind(
        session.id,
        PLANNING_SESSION_ARCHIVE_KIND.nativeEvents,
      );

      if (!existingArchive) {
        const events = await collectNativeEvents(session.id, eventPageSize, deps);
        if (events.length > 0) {
          const uploaded = await deps.uploadNativeEventsArchive(session.id, events);
          await deps.upsertEventArchive({
            planningSessionId: session.id,
            archiveKind: PLANNING_SESSION_ARCHIVE_KIND.nativeEvents,
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
          stats.nativeArchivesCreated += 1;
        }
      }

      const deleted = await deps.deleteAgentNativeEventsBySessionId(session.id);
      stats.nativeRowsDeleted += deleted;
    }
  }

  stats.durationMs = Date.now() - startedAt;
  stats.lastRunAt = new Date().toISOString();

  deps.logger.info(
    {
      ...stats,
      nativeCutoff: nativeCutoff.toISOString(),
      canonicalCutoff: canonicalCutoff.toISOString(),
      sessionBatchSize,
      eventPageSize,
    },
    "[planning-session-archive-sweeper] Sweep completed",
  );

  return stats;
};

export const startPlanningSessionArchiveSweeper = (
  cfg?: PlanningSessionArchiveSweeperConfig,
): (() => void) => {
  const intervalMs = Math.max(30_000, Math.floor(cfg?.intervalMs ?? DEFAULT_INTERVAL_MS));

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runPlanningSessionArchiveSweeperOnce(cfg);
    } catch (err) {
      logger.error({ err }, "[planning-session-archive-sweeper] Unhandled error in sweep tick");
    } finally {
      running = false;
    }
  };

  setTimeout(() => void tick(), 15_000);
  timer = setInterval(() => void tick(), intervalMs);

  logger.info({ intervalMs }, "[planning-session-archive-sweeper] Background sweeper started");

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    logger.info("[planning-session-archive-sweeper] Background sweeper stopped");
  };
};
