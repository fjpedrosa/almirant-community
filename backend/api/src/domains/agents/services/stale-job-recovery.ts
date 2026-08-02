import {
  agentJobs,
  agentJobClaimSequenceReceipts,
  agentJobLogs,
  db,
  and,
  eq,
  lt,
  lte,
  inArray,
  isNull,
  isNotNull,
  markOfflineWorkers,
  workerRegistrations,
  setWorkItemAiProcessing,
  workItems,
  projects,
  boardColumns,
  findColumnByNameInBoard,
  sql,
  findJobsWithUnprocessedAnsweredInteractions,
  interruptPlanningSession,
  getPlanningSessionById,
  getWorkItemsBySession,
  getSeedsBySession,
  failActiveAttemptForCancelledJob,
  failActiveAttemptForFailedJob,
} from "@almirant/database";
import type { AgentJobConfig, InterruptionContext } from "@almirant/database";
import { getTableColumns, type SQL } from "drizzle-orm";
import { wsConnectionManager } from "../../../shared/ws/ws-connection-manager";
import { logger } from "@almirant/config";
import { isPreSessionStartupStuck } from "./agent-job-startup-watchdog";
import { resolveStaleRecoveryTerminalIntent } from "./stale-job-terminal-intent";

const JOB_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours (must exceed runner's max overall timeout)
const PRE_SESSION_STARTUP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — backend safety net; runner should kill earlier
const FINALIZING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — jobs stuck in post-processing should fail fast
const MISSING_WORKER_GRACE_MS = 5 * 60 * 1000; // 5 minutes — avoid reclaiming brief worker-registration races
const STALE_WORK_ITEM_MS = 60 * 60 * 1000; // 1 hour — work items stuck in transient columns longer than this are reset
const STUCK_WAITING_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes — jobs stuck in waiting_for_input with all interactions resolved

const ACTIVE_JOB_STATUSES = ["queued", "running", "finalizing", "waiting_for_input", "paused"] as const;
// Worker-bound active statuses exclude `waiting_for_input`: jobs in that
// status are legitimately paused waiting for a human reply, and stealing the
// session out from under them would lose the pending interaction. Timeouts
// for waiting_for_input are owned by the dedicated interaction sweeper
// (e.g. findJobsWithUnprocessedAnsweredInteractions further down) and the
// per-interaction `expiresAt` deadline.
const WORKER_BOUND_ACTIVE_STATUSES = ["running", "finalizing"] as const;

type StaleJobRecoveryConfig = {
  intervalMs?: number;
  offlineThresholdMs?: number;
};

type RecoveryJobSnapshot = typeof agentJobs.$inferSelect & {
  recoveryXmin: string;
  recoveryUpdatedAt: string;
};

type StaleRecoveryPatch = Partial<
  Omit<typeof agentJobs.$inferInsert, "config">
> & {
  config?: AgentJobConfig | SQL;
};

const recoveryJobSelection = {
  job: agentJobs,
  recoveryXmin: sql<string>`${agentJobs}.xmin::text`.as("recovery_xmin"),
  recoveryUpdatedAt: sql<string>`${agentJobs}."updated_at"::text`.as(
    "recovery_updated_at",
  ),
};

const toRecoveryJobSnapshot = (row: {
  job: typeof agentJobs.$inferSelect;
  recoveryXmin: string;
  recoveryUpdatedAt: string;
}): RecoveryJobSnapshot => ({
  ...row.job,
  recoveryXmin: row.recoveryXmin,
  recoveryUpdatedAt: row.recoveryUpdatedAt,
});

/** Resolve workspaceId from a workItemId via the work item's project. */
const resolveOrgIdFromWorkItem = async (workItemId: string | null): Promise<string | null> => {
  if (!workItemId) return null;
  const [row] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(eq(workItems.id, workItemId))
    .limit(1);
  return row?.workspaceId ?? null;
};

const broadcastStatusChanged = async (args: {
  jobId: string;
  status: string;
  workItemId: string | null;
  workspaceId?: string | null;
}) => {
  const orgId = args.workspaceId ?? await resolveOrgIdFromWorkItem(args.workItemId);
  if (!orgId) return;
  wsConnectionManager.broadcastToWorkspace(orgId, {
    type: "agent-job:status-changed",
    payload: {
      jobId: args.jobId,
      status: args.status,
      workItemId: args.workItemId,
    },
  });
};

const interruptParentPlanningSession = async (
  job: typeof agentJobs.$inferSelect,
  reason: string,
  orgId: string
): Promise<void> => {
  try {
    if (!job.planningSessionId) return;

    const session = await getPlanningSessionById(job.planningSessionId);
    if (!session || session.status !== "active") return;

    const sessionWorkItems = await getWorkItemsBySession(job.planningSessionId);
    const sessionSeeds = await getSeedsBySession(job.planningSessionId);

    const context: InterruptionContext = {
      reason,
      lastPhase: "unknown",
      workItemsCreatedSoFar: sessionWorkItems.length,
      seedsProcessedSoFar: sessionSeeds.length,
      lastJobId: job.id,
      interruptedAt: new Date().toISOString(),
    };

    await interruptPlanningSession(job.planningSessionId, context);

    wsConnectionManager.broadcastToWorkspace(orgId, {
      type: "planning-session:interrupted" as any,
      payload: {
        sessionId: job.planningSessionId,
        reason,
        workItemsCreated: sessionWorkItems.length,
      },
    });

    logger.info(
      { jobId: job.id, planningSessionId: job.planningSessionId, reason },
      "Stale job recovery: interrupted parent planning session"
    );
  } catch (err) {
    logger.error(
      { jobId: job.id, planningSessionId: job.planningSessionId, err },
      "Stale job recovery: failed to interrupt parent planning session"
    );
  }
};

const clearAiProcessingFlagForJob = async (
  job: Pick<typeof agentJobs.$inferSelect, "id" | "workItemId">,
  context: string,
): Promise<void> => {
  if (!job.workItemId) return;

  try {
    const orgId = await resolveOrgIdFromWorkItem(job.workItemId);
    if (!orgId) return;

    await setWorkItemAiProcessing(orgId, job.workItemId, false);
    wsConnectionManager.broadcastToWorkspace(orgId, {
      type: "work-item:updated",
      payload: { workItemId: job.workItemId, changes: { isAiProcessing: false } },
    });
  } catch (err) {
    logger.error({ jobId: job.id, workItemId: job.workItemId, err }, context);
  }
};

const requeueRecoveredJob = async (
  job: RecoveryJobSnapshot,
  now: Date,
  reason: string,
): Promise<void> => {
  const segmentMs = job.startedAt instanceof Date
    ? Math.max(0, now.getTime() - job.startedAt.getTime())
    : 0;
  const newCumulative = (job.cumulativeDurationMs ?? 0) + segmentMs;

  const updated = await recoverStaleJobWithReceipt(job, {
    status: "queued",
    retryCount: job.retryCount + 1,
    workerId: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorMessage: null,
    errorType: null,
    config: sql`jsonb_set(
      ${agentJobs.config} - 'claimAttemptId',
      '{previousJobId}',
      to_jsonb(${job.id}::text),
      true
    )`,
    cumulativeDurationMs: newCumulative,
    updatedAt: now,
  });

  if (!updated) return;

  if (updated.status === "cancelled" || updated.status === "failed") {
    await cascadeRecoveredTerminalJob(updated);
    void broadcastStatusChanged({
      jobId: updated.id,
      status: updated.status,
      workItemId: updated.workItemId ?? null,
      workspaceId: updated.workspaceId,
    });
    logger.warn(
      {
        jobId: updated.id,
        prevWorkerId: job.workerId,
        terminalStatus: updated.status,
        reason,
      },
      "Stale job recovery: applied pending terminal intent instead of re-queueing",
    );
    await clearAiProcessingFlagForJob(
      updated,
      "Failed to clear AI processing flag after pending terminal recovery",
    );
    return;
  }

  void broadcastStatusChanged({ jobId: updated.id, status: updated.status, workItemId: updated.workItemId ?? null, workspaceId: updated.workspaceId });
  logger.warn(
    { jobId: updated.id, prevWorkerId: job.workerId, retryCount: updated.retryCount, maxRetries: updated.maxRetries, reason },
    "Stale job recovery: re-queued orphaned active job",
  );

  await clearAiProcessingFlagForJob(updated, "Failed to clear AI processing flag during re-queue");
};

const resumePausedQuotaJob = async (
  job: RecoveryJobSnapshot,
  now: Date,
): Promise<void> => {
  const updated = await recoverStaleJobWithReceipt(job, {
    status: "queued",
    workerId: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    availableAt: null,
    errorMessage: null,
    errorType: null,
    config: sql`jsonb_set(
      ${agentJobs.config} - 'claimAttemptId',
      '{previousJobId}',
      to_jsonb(COALESCE(
        ${agentJobs.config} ->> 'previousJobId',
        ${job.id}::text
      )),
      true
    )`,
    updatedAt: now,
  });

  if (!updated) return;

  if (updated.status === "cancelled" || updated.status === "failed") {
    await cascadeRecoveredTerminalJob(updated);
    void broadcastStatusChanged({
      jobId: updated.id,
      status: updated.status,
      workItemId: updated.workItemId ?? null,
      workspaceId: updated.workspaceId,
    });
    logger.warn(
      {
        jobId: updated.id,
        terminalStatus: updated.status,
        workItemId: updated.workItemId,
        workspaceId: updated.workspaceId,
      },
      "Stale job recovery: terminalized quota-paused job instead of re-queueing",
    );
    await clearAiProcessingFlagForJob(
      updated,
      "Failed to clear AI processing flag after terminal quota recovery",
    );
    return;
  }

  void broadcastStatusChanged({
    jobId: updated.id,
    status: updated.status,
    workItemId: updated.workItemId ?? null,
    workspaceId: updated.workspaceId,
  });

  logger.info(
    { jobId: updated.id, workItemId: updated.workItemId, workspaceId: updated.workspaceId },
    "Stale job recovery: re-queued quota-paused job after reset",
  );
};

/**
 * Fence a sweeper write to the exact row generation it selected. The explicit
 * "no nonce" predicate is as important as matching a nonce: otherwise a
 * legacy snapshot could overwrite a newly claimed durable generation.
 *
 * Ported from cloud (agent-job-repository.ts's sibling stale-job-recovery.ts)
 * unchanged — no Shoutrz dependency.
 */
const selectedJobFence = (job: RecoveryJobSnapshot) => {
  const claimAttemptId = (job.config as AgentJobConfig | null | undefined)
    ?.claimAttemptId;
  return and(
    eq(agentJobs.id, job.id),
    eq(agentJobs.status, job.status),
    sql`${agentJobs}.xmin::text = ${job.recoveryXmin}`,
    sql`${agentJobs}."updated_at"::text = ${job.recoveryUpdatedAt}`,
    job.workerId === null
      ? isNull(agentJobs.workerId)
      : eq(agentJobs.workerId, job.workerId),
    job.sessionId === null
      ? isNull(agentJobs.sessionId)
      : eq(agentJobs.sessionId, job.sessionId),
    job.availableAt === null
      ? isNull(agentJobs.availableAt)
      : eq(agentJobs.availableAt, job.availableAt),
    typeof claimAttemptId === "string" && claimAttemptId.length > 0
      ? sql`${agentJobs.config} ->> 'claimAttemptId' = ${claimAttemptId}`
      : sql`COALESCE(${agentJobs.config} ->> 'claimAttemptId', '') = ''`,
  );
};

/**
 * Apply one stale-recovery transition to the exact selected snapshot. Durable
 * claims lock receipt then job, and mark the immutable reservation crashed in
 * the same transaction so a later claim always reserves above its range.
 *
 * Ported from cloud with the site-build execution-deadline authorization
 * layer removed (Shoutrz only, no `site_build_runs` table in community):
 * cloud's `authorizeStaleRecoverySuccessorAfterLock` races a `queued` patch
 * against the deadline and can downgrade it to `failed`; here, locking the
 * selected row generation is the only authorization a requeue needs.
 */
const recoverStaleJobWithReceipt = async (
  job: RecoveryJobSnapshot,
  patch: StaleRecoveryPatch,
): Promise<typeof agentJobs.$inferSelect | null> => {
  const claimAttemptId = (job.config as AgentJobConfig | null | undefined)
    ?.claimAttemptId;

  return db.transaction(async (tx) => {
    let locked: boolean;
    if (typeof claimAttemptId === "string" && claimAttemptId.length > 0) {
      const [row] = await tx
        .select({ state: agentJobClaimSequenceReceipts.state })
        .from(agentJobClaimSequenceReceipts)
        .innerJoin(
          agentJobs,
          eq(agentJobs.id, agentJobClaimSequenceReceipts.jobId),
        )
        .where(
          and(
            selectedJobFence(job),
            eq(agentJobClaimSequenceReceipts.jobId, job.id),
            eq(agentJobClaimSequenceReceipts.claimAttemptId, claimAttemptId),
            job.workerId === null
              ? isNull(agentJobClaimSequenceReceipts.workerId)
              : eq(agentJobClaimSequenceReceipts.workerId, job.workerId),
            inArray(agentJobClaimSequenceReceipts.state, [
              "active",
              "draining",
              "ready",
            ]),
          ),
        )
        .for("update");
      locked = Boolean(row);
    } else {
      const [row] = await tx
        .select({ id: agentJobs.id })
        .from(agentJobs)
        .where(selectedJobFence(job))
        .for("update");
      locked = Boolean(row);
    }
    if (!locked) return null;

    const terminalIntent = resolveStaleRecoveryTerminalIntent(job.config, {
      result:
        patch.result &&
        typeof patch.result === "object" &&
        !Array.isArray(patch.result)
          ? patch.result as unknown as Record<string, unknown>
          : undefined,
      errorType: typeof patch.errorType === "string" ? patch.errorType : undefined,
      errorMessage:
        typeof patch.errorMessage === "string" ? patch.errorMessage : undefined,
      durationMs:
        typeof patch.durationMs === "number" ? patch.durationMs : undefined,
    });
    const effectivePatch = terminalIntent
      ? {
          ...patch,
          status: terminalIntent.status,
          workerId: null,
          result: terminalIntent.result as never,
          errorType: terminalIntent.errorType ?? null,
          errorMessage: terminalIntent.errorMessage ?? null,
          durationMs: terminalIntent.durationMs,
          completedAt: terminalIntent.completedAt,
          failedAt: terminalIntent.failedAt,
          config: sql`${agentJobs.config} - 'claimAttemptId' - 'pendingTerminalIntent'`,
          updatedAt: new Date(),
        }
      : patch;

    const [updated] = await tx
      .update(agentJobs)
      .set(effectivePatch)
      .where(selectedJobFence(job))
      .returning(getTableColumns(agentJobs));
    if (!updated) return null;

    if (typeof claimAttemptId === "string" && claimAttemptId.length > 0) {
      const [crashedReceipt] = await tx
        .update(agentJobClaimSequenceReceipts)
        .set({
          state: "crashed",
          finalizedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentJobClaimSequenceReceipts.jobId, job.id),
            eq(agentJobClaimSequenceReceipts.claimAttemptId, claimAttemptId),
            inArray(agentJobClaimSequenceReceipts.state, [
              "active",
              "draining",
              "ready",
            ]),
          ),
        )
        .returning({ claimAttemptId: agentJobClaimSequenceReceipts.claimAttemptId });
      if (!crashedReceipt) {
        throw new Error("Claim sequence receipt changed during stale recovery");
      }
    }

    return updated;
  });
};

/**
 * CRÍTICO 1(a): the stale-recovery sweeps fail/cancel jobs via
 * `recoverStaleJobWithReceipt`, which bypasses `updateJobStatus`/
 * `requestJobTerminalIntent`, so they must cascade to the linked
 * bug_fix_attempt themselves — otherwise an attempt whose job dies
 * `failed`/`cancelled` stays active ("implementing") forever and the cluster
 * never reopens. Fire-and-log: a cascade hiccup must never mask the job
 * recovery. Extended (community#16c) to also cascade `cancelled`, since a
 * held `pendingTerminalIntent` applied by `recoverStaleJobWithReceipt` can
 * now terminalize a job as `cancelled` instead of the sweep's own requested
 * status.
 */
const cascadeRecoveredTerminalJob = async (
  job: Pick<typeof agentJobs.$inferSelect, "id" | "status">,
): Promise<void> => {
  if (job.status !== "cancelled" && job.status !== "failed") return;

  try {
    if (job.status === "cancelled") {
      await failActiveAttemptForCancelledJob(job.id);
    } else {
      await failActiveAttemptForFailedJob(job.id);
    }
  } catch (err) {
    logger.warn(
      { err, jobId: job.id, terminalStatus: job.status },
      "Stale job recovery: failed to cascade terminal job to bug_fix_attempts"
    );
  }
};

const failRecoveredJob = async (
  job: RecoveryJobSnapshot,
  now: Date,
  params: {
    errorType: string;
    errorMessage: string;
    logMessage: string;
    logLevel?: "warn" | "error";
    interruptReason?: string;
  },
): Promise<void> => {
  const segmentMs = job.startedAt instanceof Date
    ? Math.max(0, now.getTime() - job.startedAt.getTime())
    : 0;
  const totalDuration = (job.cumulativeDurationMs ?? 0) + segmentMs;

  const updated = await recoverStaleJobWithReceipt(job, {
    status: "failed",
    failedAt: now,
    durationMs: totalDuration > 0 ? totalDuration : undefined,
    errorType: params.errorType,
    errorMessage: job.errorMessage ?? params.errorMessage,
    config: sql`${agentJobs.config} - 'claimAttemptId'`,
    updatedAt: now,
  });

  if (!updated) return;

  await cascadeRecoveredTerminalJob(updated);

  void broadcastStatusChanged({ jobId: updated.id, status: updated.status, workItemId: updated.workItemId ?? null, workspaceId: updated.workspaceId });

  const orgId = job.workspaceId ?? await resolveOrgIdFromWorkItem(job.workItemId);
  if (orgId && params.interruptReason) {
    void interruptParentPlanningSession(job, params.interruptReason, orgId);
  }

  logger[params.logLevel ?? "error"](
    { jobId: updated.id, workerId: job.workerId, retryCount: updated.retryCount, maxRetries: updated.maxRetries, errorType: params.errorType },
    params.logMessage,
  );

  await clearAiProcessingFlagForJob(updated, "Failed to clear AI processing flag during failure");
};

const recoverWorkerBoundJob = async (
  job: RecoveryJobSnapshot,
  now: Date,
  reason: string,
): Promise<void> => {
  const canRequeue = job.status !== "finalizing" && job.retryCount < job.maxRetries;

  if (canRequeue) {
    await requeueRecoveredJob(job, now, reason);
    return;
  }

  const isFinalizing = job.status === "finalizing";
  await failRecoveredJob(job, now, {
    errorType: isFinalizing ? "post-processing-abandoned" : "worker-crash",
    errorMessage: isFinalizing
      ? `Job got stuck in finalizing because the worker disappeared (${reason})`
      : "Worker went offline while job was running",
    logMessage: isFinalizing
      ? "Stale job recovery: failed finalizing job after worker loss"
      : "Stale job recovery: job failed (max retries exceeded)",
    interruptReason: "runner_offline",
  });
};

export const runStaleJobRecoveryOnce = async (cfg?: StaleJobRecoveryConfig): Promise<void> => {
  const offlineThresholdMs = cfg?.offlineThresholdMs ?? 90_000;
  await markOfflineWorkers(offlineThresholdMs);

  const offlineWorkers = await db
    .select({ workerId: workerRegistrations.workerId })
    .from(workerRegistrations)
    .where(eq(workerRegistrations.status, "offline"));

  const offlineWorkerIds = offlineWorkers.map((w) => w.workerId).filter((x): x is string => typeof x === "string" && x.length > 0);

  // --- Offline-worker sweep: recover orphaned jobs from workers that went offline ---
  if (offlineWorkerIds.length > 0) {
    const orphaned = await db
      .select(recoveryJobSelection)
      .from(agentJobs)
      .where(
        and(
          inArray(agentJobs.status, WORKER_BOUND_ACTIVE_STATUSES),
          isNotNull(agentJobs.workerId),
          inArray(agentJobs.workerId, offlineWorkerIds)
        )
      );

    const now = new Date();

    for (const row of orphaned) {
      const job = toRecoveryJobSnapshot(row);
      try {
        await recoverWorkerBoundJob(job, now, "worker registration is offline");
      } catch (err) {
        logger.error({ jobId: job.id, err }, "Stale job recovery: failed to recover job");
      }
    }
  }

  // --- Quota-reset sweep: resume paused jobs once their quota reset window opens ---
  try {
    const now = new Date();
    const resumablePausedJobs = await db
      .select(recoveryJobSelection)
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, "paused"),
          isNotNull(agentJobs.availableAt),
          lte(agentJobs.availableAt, now),
        )
      );

    for (const row of resumablePausedJobs) {
      const job = toRecoveryJobSnapshot(row);
      try {
        await resumePausedQuotaJob(job, now);
      } catch (err) {
        logger.error({ jobId: job.id, err }, "Stale job recovery: failed to resume quota-paused job");
      }
    }
  } catch (err) {
    logger.error({ err }, "Stale job recovery: quota-paused job sweep failed");
  }

  // --- Missing-worker sweep: recover jobs whose workerId no longer exists at all ---
  try {
    const missingWorkerCutoff = new Date(Date.now() - Math.max(offlineThresholdMs, MISSING_WORKER_GRACE_MS));
    const orphaned = await db
      .select(recoveryJobSelection)
      .from(agentJobs)
      .leftJoin(workerRegistrations, eq(agentJobs.workerId, workerRegistrations.workerId))
      .where(
        and(
          inArray(agentJobs.status, WORKER_BOUND_ACTIVE_STATUSES),
          isNotNull(agentJobs.workerId),
          isNull(workerRegistrations.workerId),
          lt(agentJobs.updatedAt, missingWorkerCutoff),
        )
      );

    const now = new Date();

    for (const row of orphaned) {
      const job = toRecoveryJobSnapshot(row);
      try {
        await recoverWorkerBoundJob(job, now, "worker registration disappeared");
      } catch (err) {
        logger.error({ jobId: job.id, err }, "Stale job recovery: failed to recover missing-worker job");
      }
    }
  } catch (err) {
    logger.error({ err }, "Stale job recovery: missing-worker sweep failed");
  }

  // --- Pre-session startup watchdog: recover jobs that reached serve.ready but never created a session ---
  // The runner owns the real container kill path. This backend sweep is a slower
  // safety net for runner bugs/restarts where the worker stays online but the
  // job has no session after serve readiness.
  try {
    const cutoff = new Date(Date.now() - PRE_SESSION_STARTUP_TIMEOUT_MS);
    // Values interpolated inside a raw SQL fragment do not get the timestamp
    // encoder that Drizzle's `lt()` applies. postgres-js cannot bind a Date as
    // an untyped raw parameter, so pass the ISO representation explicitly.
    const cutoffIso = cutoff.toISOString();
    const candidateJobRows = await db
      .select(recoveryJobSelection)
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, "running"),
          isNull(agentJobs.sessionId),
          isNotNull(agentJobs.startedAt),
          lt(agentJobs.startedAt, cutoff),
          sql`exists (
            select 1
              from agent_job_logs srl
              where srl.job_id = ${agentJobs.id}
                and srl.event_type = 'serve.ready'
                and srl.timestamp < ${cutoffIso}
          )`,
        ),
      );
    const candidateJobs = candidateJobRows.map(toRecoveryJobSnapshot);

    const candidateLogStates = candidateJobs.length === 0
      ? []
      : await db
          .select({
            jobId: agentJobLogs.jobId,
            lastServeReadyAt: sql<Date | string | null>`max(${agentJobLogs.timestamp}) filter (
              where ${agentJobLogs.eventType} = 'serve.ready'
            )`,
            hasSessionCreatedLog: sql<boolean>`coalesce(
              bool_or(${agentJobLogs.eventType} = 'session.created'),
              false
            )`,
          })
          .from(agentJobLogs)
          .where(
            and(
              inArray(agentJobLogs.jobId, candidateJobs.map((job) => job.id)),
              inArray(agentJobLogs.eventType, ["serve.ready", "session.created"]),
            ),
          )
          .groupBy(agentJobLogs.jobId);

    const logStateByJobId = new Map(
      candidateLogStates.map((state) => [state.jobId, state]),
    );
    const candidates = candidateJobs.map((job) => {
      const state = logStateByJobId.get(job.id);
      const rawLastServeReadyAt = state?.lastServeReadyAt ?? null;
      return {
        job,
        lastServeReadyAt: rawLastServeReadyAt instanceof Date
          ? rawLastServeReadyAt
          : rawLastServeReadyAt
            ? new Date(rawLastServeReadyAt)
            : null,
        hasSessionCreatedLog: state?.hasSessionCreatedLog === true,
      };
    });

    const now = new Date();

    for (const candidate of candidates) {
      try {
        const stuck = isPreSessionStartupStuck(
          {
            status: candidate.job.status,
            sessionId: candidate.job.sessionId ?? null,
            startedAt: candidate.job.startedAt ?? null,
            lastServeReadyAt: candidate.lastServeReadyAt ?? null,
            hasSessionCreatedLog: candidate.hasSessionCreatedLog === true,
          },
          now,
          PRE_SESSION_STARTUP_TIMEOUT_MS,
        );

        if (!stuck) continue;

        await recoverWorkerBoundJob(
          candidate.job,
          now,
          "pre-session startup timed out after serve.ready without session.created",
        );

        logger.warn(
          {
            jobId: candidate.job.id,
            workerId: candidate.job.workerId,
            lastServeReadyAt: candidate.lastServeReadyAt,
            timeoutMs: PRE_SESSION_STARTUP_TIMEOUT_MS,
          },
          "Stale job recovery: recovered job stuck before session creation",
        );
      } catch (err) {
        logger.error({ jobId: candidate.job.id, err }, "Stale job recovery: failed to recover pre-session stuck job");
      }
    }
  } catch (err) {
    logger.error({ err }, "Stale job recovery: pre-session startup watchdog failed");
  }

  // --- Timeout sweep: fail jobs running longer than 4 hours ---
  try {
    const cutoff = new Date(Date.now() - JOB_TIMEOUT_MS);
    const timedOutJobRows = await db
      .select(recoveryJobSelection)
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, "running"),
          isNotNull(agentJobs.startedAt),
          lt(agentJobs.startedAt, cutoff)
        )
      );

    for (const row of timedOutJobRows) {
      const job = toRecoveryJobSnapshot(row);
      try {
        const now = new Date();
        const segmentMs = job.startedAt instanceof Date
          ? Math.max(0, now.getTime() - job.startedAt.getTime())
          : 0;
        const totalDuration = (job.cumulativeDurationMs ?? 0) + segmentMs;

        const updated = await recoverStaleJobWithReceipt(job, {
          status: "failed",
          failedAt: now,
          durationMs: totalDuration > 0 ? totalDuration : undefined,
          errorType: "timeout",
          errorMessage: `Job timed out after ${Math.round(totalDuration / 60000)} minutes`,
          config: sql`${agentJobs.config} - 'claimAttemptId'`,
          updatedAt: now,
        });

        if (updated) {
          await cascadeRecoveredTerminalJob(updated);
          void broadcastStatusChanged({ jobId: updated.id, status: updated.status, workItemId: updated.workItemId ?? null, workspaceId: updated.workspaceId });
          const orgId = job.workspaceId ?? await resolveOrgIdFromWorkItem(job.workItemId);
          if (orgId) {
            void interruptParentPlanningSession(job, "idle_timeout", orgId);
          }

          if (job.workItemId) {
            const timeoutOrgId = await resolveOrgIdFromWorkItem(job.workItemId);
            if (timeoutOrgId) {
              await setWorkItemAiProcessing(timeoutOrgId, job.workItemId, false);
              wsConnectionManager.broadcastToWorkspace(timeoutOrgId, { type: "work-item:updated", payload: { workItemId: job.workItemId, changes: { isAiProcessing: false } } });
            }
          }

          logger.warn(
            { jobId: updated.id, workerId: job.workerId, durationMs: totalDuration, startedAt: job.startedAt },
            "Stale job recovery: job timed out"
          );
        }
      } catch (err) {
        logger.error({ jobId: job.id, err }, "Stale job recovery: failed to timeout job");
      }
    }
  } catch (err) {
    logger.error({ err }, "Stale job recovery: timeout sweep failed");
  }

  // --- Finalizing watchdog: fail jobs stuck in post-processing too long ---
  try {
    const cutoff = new Date(Date.now() - FINALIZING_TIMEOUT_MS);
    const stuckFinalizingJobRows = await db
      .select(recoveryJobSelection)
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, "finalizing"),
          lt(agentJobs.updatedAt, cutoff),
        )
      );

    for (const row of stuckFinalizingJobRows) {
      const job = toRecoveryJobSnapshot(row);
      try {
        const stuckMinutes = Math.max(1, Math.round((Date.now() - job.updatedAt.getTime()) / 60000));
        await failRecoveredJob(job, new Date(), {
          errorType: "post-processing-timeout",
          errorMessage: `Job stuck in finalizing for ${stuckMinutes} minutes`,
          logMessage: "Stale job recovery: job stuck in finalizing timed out",
          logLevel: "warn",
          interruptReason: "post_processing_timeout",
        });
      } catch (err) {
        logger.error({ jobId: job.id, err }, "Stale job recovery: failed to recover finalizing job");
      }
    }
  } catch (err) {
    logger.error({ err }, "Stale job recovery: finalizing watchdog failed");
  }

  // --- Stuck waiting_for_input sweep ---
  // Recovers jobs stuck in waiting_for_input where all interactions are already
  // in a terminal state (answered/timed_out/cancelled) but the runner never
  // processed the response (e.g. field mismatch between response/answerText).
  try {
    const stuckJobs = await findJobsWithUnprocessedAnsweredInteractions(STUCK_WAITING_THRESHOLD_MS);

    for (const stuckJob of stuckJobs) {
      try {
        const now = new Date();
        const selectedJob = await db
          .select(recoveryJobSelection)
          .from(agentJobs)
          .where(eq(agentJobs.id, stuckJob.jobId))
          .limit(1)
          .then((rows) => rows[0]);

        const jobRow = selectedJob ? toRecoveryJobSnapshot(selectedJob) : undefined;

        if (!jobRow || jobRow.status !== "waiting_for_input") continue;

        const segmentMs = jobRow.startedAt instanceof Date
          ? Math.max(0, now.getTime() - jobRow.startedAt.getTime())
          : 0;
        const totalDuration = (jobRow.cumulativeDurationMs ?? 0) + segmentMs;

        const stuckDurationMs = now.getTime() - new Date(stuckJob.latestInteractionUpdatedAt).getTime();

        const updated = await recoverStaleJobWithReceipt(jobRow, {
          status: "failed",
          failedAt: now,
          durationMs: totalDuration > 0 ? totalDuration : undefined,
          errorType: "interaction-mismatch",
          errorMessage: `Job stuck in waiting_for_input for ${Math.round(stuckDurationMs / 60000)} minutes with all interactions resolved`,
          config: sql`${agentJobs.config} - 'claimAttemptId'`,
          updatedAt: now,
        });

        if (updated) {
          await cascadeRecoveredTerminalJob(updated);
          void broadcastStatusChanged({ jobId: updated.id, status: updated.status, workItemId: updated.workItemId ?? null, workspaceId: updated.workspaceId });
          const orgId = jobRow.workspaceId ?? await resolveOrgIdFromWorkItem(jobRow.workItemId);
          if (orgId) {
            void interruptParentPlanningSession(jobRow, "idle_timeout", orgId);
          }
          logger.warn(
            {
              jobId: updated.id,
              latestInteractionId: stuckJob.latestInteractionId,
              stuckDurationMs,
              workerId: jobRow.workerId,
            },
            "Stale job recovery: failed job stuck in waiting_for_input with resolved interactions (interaction-mismatch)"
          );

          // Clear AI processing flag so the UI no longer shows a spinner
          if (updated.workItemId) {
            try {
              const orgId = await resolveOrgIdFromWorkItem(updated.workItemId);
              if (orgId) {
                await setWorkItemAiProcessing(orgId, updated.workItemId, false);
                wsConnectionManager.broadcastToWorkspace(orgId, {
                  type: "work-item:updated",
                  payload: { workItemId: updated.workItemId, changes: { isAiProcessing: false } },
                });
              }
            } catch (cleanupErr) {
              logger.error({ jobId: updated.id, workItemId: updated.workItemId, err: cleanupErr }, "Failed to clear AI processing flag during interaction-mismatch recovery");
            }
          }
        }
      } catch (err) {
        logger.error({ jobId: stuckJob.jobId, err }, "Stale job recovery: failed to recover stuck waiting_for_input job");
      }
    }
  } catch (err) {
    logger.error({ err }, "Stale job recovery: stuck waiting_for_input sweep failed");
  }

  // --- Orphaned work-item sweep: reset items stuck in transient columns with no active job ---
  // Safety net for cases where the runner's per-job cleanup was skipped (e.g. session
  // "succeeded" but MCP calls never completed, or OOM kill after session end).
  try {
    const staleWorkItemCutoff = new Date(Date.now() - STALE_WORK_ITEM_MS);

    const stuckItems = await db
      .select({
        id: workItems.id,
        boardId: workItems.boardId,
        columnName: boardColumns.name,
        projectId: workItems.projectId,
      })
      .from(workItems)
      .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
      .where(
        and(
          eq(workItems.isAiProcessing, true),
          lt(workItems.updatedAt, staleWorkItemCutoff),
          sql`lower(trim(${boardColumns.name})) IN ('validating')`,
        )
      );

    if (stuckItems.length > 0) {
      // Check that none of these items have an active job
      const stuckIds = stuckItems.map((i) => i.id);
      const activeJobs = await db
        .select({ workItemId: agentJobs.workItemId })
        .from(agentJobs)
        .where(
          and(
            inArray(agentJobs.workItemId, stuckIds),
            inArray(agentJobs.status, ACTIVE_JOB_STATUSES),
          )
        );
      const activeWorkItemIds = new Set(activeJobs.map((j) => j.workItemId).filter(Boolean));

      // Group orphaned items by boardId for bulk reset
      const orphanedByBoard = new Map<string, string[]>();
      for (const item of stuckItems) {
        if (activeWorkItemIds.has(item.id)) continue;
        const list = orphanedByBoard.get(item.boardId);
        if (list) list.push(item.id);
        else orphanedByBoard.set(item.boardId, [item.id]);
      }

      const now = new Date();
      let resetCount = 0;

      for (const [boardId, itemIds] of orphanedByBoard) {
        const reviewColumn = await findColumnByNameInBoard(boardId, "To Review");
        if (!reviewColumn) continue;

        await db
          .update(workItems)
          .set({ boardColumnId: reviewColumn.id, isAiProcessing: false, updatedAt: now })
          .where(inArray(workItems.id, itemIds));

        resetCount += itemIds.length;

        // Broadcast updates so the frontend refreshes
        for (const itemId of itemIds) {
          const orgId = await resolveOrgIdFromWorkItem(itemId);
          if (orgId) {
            wsConnectionManager.broadcastToWorkspace(orgId, {
              type: "work-item:updated",
              payload: { workItemId: itemId, boardId, changes: { boardColumnId: reviewColumn.id, isAiProcessing: false } },
            });
          }
        }
      }

      if (resetCount > 0) {
        logger.warn(
          { resetCount, itemIds: [...orphanedByBoard.values()].flat() },
          "Stale job recovery: reset orphaned work items stuck in Validating with no active job"
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Stale job recovery: orphaned work-item sweep failed");
  }
};

export const startStaleJobRecovery = (cfg?: StaleJobRecoveryConfig): (() => void) => {
  const intervalMs = cfg?.intervalMs ?? 120_000;

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runStaleJobRecoveryOnce(cfg);
    } catch (err) {
      logger.error(
        { err },
        "Stale job recovery: tick failed (transient DB error, will retry next interval)"
      );
    } finally {
      running = false;
    }
  };

  // Run once shortly after boot (but don't block startup).
  setTimeout(() => void tick(), 5_000);
  timer = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
};
