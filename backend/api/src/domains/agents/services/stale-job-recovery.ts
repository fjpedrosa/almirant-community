import {
  agentJobs,
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
  failActiveAttemptForFailedJob,
} from "@almirant/database";
import type { AgentJobConfig, InterruptionContext } from "@almirant/database";
import { wsConnectionManager } from "../../../shared/ws/ws-connection-manager";
import { logger } from "@almirant/config";
import { isPreSessionStartupStuck } from "./agent-job-startup-watchdog";

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
  job: typeof agentJobs.$inferSelect,
  now: Date,
  reason: string,
): Promise<void> => {
  const updatedConfig = {
    ...(job.config as AgentJobConfig),
    previousJobId: job.id,
  };

  const segmentMs = job.startedAt instanceof Date
    ? Math.max(0, now.getTime() - job.startedAt.getTime())
    : 0;
  const newCumulative = (job.cumulativeDurationMs ?? 0) + segmentMs;

  const [updated] = await db
    .update(agentJobs)
    .set({
      status: "queued",
      retryCount: job.retryCount + 1,
      workerId: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      errorMessage: null,
      errorType: null,
      config: updatedConfig,
      cumulativeDurationMs: newCumulative,
      updatedAt: now,
    })
    .where(eq(agentJobs.id, job.id))
    .returning();

  if (!updated) return;

  void broadcastStatusChanged({ jobId: updated.id, status: updated.status, workItemId: updated.workItemId ?? null, workspaceId: updated.workspaceId });
  logger.warn(
    { jobId: updated.id, prevWorkerId: job.workerId, retryCount: updated.retryCount, maxRetries: updated.maxRetries, reason },
    "Stale job recovery: re-queued orphaned active job",
  );

  await clearAiProcessingFlagForJob(updated, "Failed to clear AI processing flag during re-queue");
};

const resumePausedQuotaJob = async (
  job: typeof agentJobs.$inferSelect,
  now: Date,
): Promise<void> => {
  const updatedConfig = {
    ...(job.config as AgentJobConfig),
    previousJobId: (job.config as AgentJobConfig | null | undefined)?.previousJobId ?? job.id,
  };

  const [updated] = await db
    .update(agentJobs)
    .set({
      status: "queued",
      workerId: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      availableAt: null,
      errorMessage: null,
      errorType: null,
      config: updatedConfig,
      updatedAt: now,
    })
    .where(eq(agentJobs.id, job.id))
    .returning();

  if (!updated) return;

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
 * CRÍTICO 1(a): the stale-recovery sweeps fail jobs via direct
 * `db.update(agentJobs)` writes that bypass `updateJobStatus`, so they must
 * cascade to the linked bug_fix_attempt themselves — otherwise an attempt whose
 * job dies `failed` stays active ("implementing") forever and the cluster never
 * reopens. Fire-and-log: a cascade hiccup must never mask the job recovery.
 */
const cascadeFailedJobToBugFixAttempt = async (jobId: string): Promise<void> => {
  try {
    await failActiveAttemptForFailedJob(jobId);
  } catch (err) {
    logger.warn(
      { err, jobId },
      "Stale job recovery: failed to cascade job failure to bug_fix_attempts"
    );
  }
};

const failRecoveredJob = async (
  job: typeof agentJobs.$inferSelect,
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

  const [updated] = await db
    .update(agentJobs)
    .set({
      status: "failed",
      failedAt: now,
      durationMs: totalDuration > 0 ? totalDuration : undefined,
      errorType: params.errorType,
      errorMessage: job.errorMessage ?? params.errorMessage,
      updatedAt: now,
    })
    .where(eq(agentJobs.id, job.id))
    .returning();

  if (!updated) return;

  await cascadeFailedJobToBugFixAttempt(updated.id);

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
  job: typeof agentJobs.$inferSelect,
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
      .select()
      .from(agentJobs)
      .where(
        and(
          inArray(agentJobs.status, WORKER_BOUND_ACTIVE_STATUSES),
          isNotNull(agentJobs.workerId),
          inArray(agentJobs.workerId, offlineWorkerIds)
        )
      );

    const now = new Date();

    for (const job of orphaned) {
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
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, "paused"),
          isNotNull(agentJobs.availableAt),
          lte(agentJobs.availableAt, now),
        )
      );

    for (const job of resumablePausedJobs) {
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
      .select({ job: agentJobs })
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

    for (const { job } of orphaned) {
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
    const candidateJobs = await db
      .select()
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
    const timedOutJobs = await db
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, "running"),
          isNotNull(agentJobs.startedAt),
          lt(agentJobs.startedAt, cutoff)
        )
      );

    for (const job of timedOutJobs) {
      try {
        const now = new Date();
        const segmentMs = job.startedAt instanceof Date
          ? Math.max(0, now.getTime() - job.startedAt.getTime())
          : 0;
        const totalDuration = (job.cumulativeDurationMs ?? 0) + segmentMs;

        const [updated] = await db
          .update(agentJobs)
          .set({
            status: "failed",
            failedAt: now,
            durationMs: totalDuration > 0 ? totalDuration : undefined,
            errorType: "timeout",
            errorMessage: `Job timed out after ${Math.round(totalDuration / 60000)} minutes`,
            updatedAt: now,
          })
          .where(eq(agentJobs.id, job.id))
          .returning();

        if (updated) {
          await cascadeFailedJobToBugFixAttempt(updated.id);
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
    const stuckFinalizingJobs = await db
      .select()
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.status, "finalizing"),
          lt(agentJobs.updatedAt, cutoff),
        )
      );

    for (const job of stuckFinalizingJobs) {
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
        const jobRow = await db
          .select()
          .from(agentJobs)
          .where(eq(agentJobs.id, stuckJob.jobId))
          .limit(1)
          .then((rows) => rows[0]);

        if (!jobRow || jobRow.status !== "waiting_for_input") continue;

        const segmentMs = jobRow.startedAt instanceof Date
          ? Math.max(0, now.getTime() - jobRow.startedAt.getTime())
          : 0;
        const totalDuration = (jobRow.cumulativeDurationMs ?? 0) + segmentMs;

        const stuckDurationMs = now.getTime() - new Date(stuckJob.latestInteractionUpdatedAt).getTime();

        const [updated] = await db
          .update(agentJobs)
          .set({
            status: "failed",
            failedAt: now,
            durationMs: totalDuration > 0 ? totalDuration : undefined,
            errorType: "interaction-mismatch",
            errorMessage: `Job stuck in waiting_for_input for ${Math.round(stuckDurationMs / 60000)} minutes with all interactions resolved`,
            updatedAt: now,
          })
          .where(eq(agentJobs.id, stuckJob.jobId))
          .returning();

        if (updated) {
          await cascadeFailedJobToBugFixAttempt(updated.id);
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
