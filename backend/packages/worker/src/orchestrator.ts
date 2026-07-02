/**
 * Agent-job orchestrator with dependency-aware scheduling.
 *
 * Functional style -- the public API is `createOrchestrator(config): Orchestrator`.
 * Internally it manages a polling loop that:
 *   1. Claims queued jobs (respecting `maxConcurrentAgents`).
 *   2. Checks work-item-level dependencies before executing each job.
 *   3. Postpones jobs whose dependencies are not yet satisfied.
 *   4. When a job completes, re-evaluates postponed dependents.
 *   5. Handles quota/rate-limit errors with auto-resume scheduling.
 *
 * No classes are used; all state is captured in closures.
 */

import { logger } from "@almirant/config";
import {
  claimJobs,
  updateJobStatus,
  getDependencies,
  getDependents,
  getJobById,
  listAgentJobs,
} from "@almirant/database";
import type { AgentJobDb } from "@almirant/database";
import { classifyError } from "./error-classifier";
import { getSkillMemoryMb } from "./skill-resources";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  /** Unique identifier for this worker instance. */
  workerId: string;
  /** How often (ms) the orchestrator polls for new work. Default 5000. */
  pollIntervalMs?: number;
  /** Maximum number of jobs running concurrently. Default 2. */
  maxConcurrentAgents?: number;
  /** How far into the future (ms) to postpone a blocked job. Default 30000. */
  postponeDelayMs?: number;
  /**
   * Callback invoked when a job is ready to run.
   * The orchestrator marks the job as "running" and expects the callback to
   * eventually call `onJobCompleted` or `onJobFailed`.
   */
  executeJob: (job: AgentJobDb) => Promise<void>;
}

/** Options for `onJobFailed` that enable quota/rate-limit auto-resume. */
export interface JobFailureOptions {
  /** Error type hint (e.g. "quota_exhausted", "rate_limit"). */
  errorType?: string;
  /** Session id from the agent run (persisted so the next attempt can resume). */
  sessionId?: string;
  /** Explicit retry delay in ms (overrides the classifier's estimate). */
  retryAfterMs?: number;
}

export interface Orchestrator {
  /** Start the polling loop. Idempotent. */
  start: () => void;
  /** Stop the polling loop gracefully. Returns a promise that resolves once
   *  the current tick (if any) finishes. */
  stop: () => Promise<void>;
  /** Notify the orchestrator that a job completed successfully. */
  onJobCompleted: (jobId: string) => Promise<void>;
  /**
   * Notify the orchestrator that a job failed.
   *
   * For quota_exhausted and rate_limit errors, the orchestrator will
   * automatically schedule a resume with the session id preserved,
   * rather than permanently failing the job.
   */
  onJobFailed: (
    jobId: string,
    errorMessage: string,
    errorTypeOrOptions?: string | JobFailureOptions,
  ) => Promise<void>;
  /** Return the set of currently running job ids. */
  getRunningJobs: () => ReadonlySet<string>;
  /** Return the set of currently postponed job ids. */
  getPostponedJobs: () => ReadonlySet<string>;
  /** Return current RAM budget metrics. */
  getRamMetrics: () => {
    ramBudgetMb: number;
    ramCommittedMb: number;
    ramAvailableMb: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POSTPONE_DELAY_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_CONCURRENT = 2;

/** Maximum time (ms) we are willing to wait for a quota/rate-limit reset. */
const MAX_RETRY_WINDOW_MS = 6 * 3_600_000; // 6 hours

/** Safety buffer added after the estimated reset time. */
const QUOTA_RESUME_BUFFER_MS = 30_000; // 30 seconds

/**
 * How often (ms) the quota-resume background timer checks for releasable
 * postponed jobs. This is a lightweight sanity check -- the main `claimJobs`
 * query already respects `available_at`, so this timer only provides logging
 * and in-memory bookkeeping cleanup.
 */
const QUOTA_RESUME_CHECK_INTERVAL_MS = 60_000; // 1 minute

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether all work-item-level dependencies of the given job are
 * satisfied (i.e. their most recent agent jobs are completed).
 *
 * A dependency is considered satisfied when either:
 *   - The blocking work item has NO agent job at all (completed manually
 *     or never had a job).
 *   - The blocking work item's most recent agent job has status "completed".
 *
 * A dependency is NOT satisfied when the blocker's latest job is in any
 * other status (queued, running, failed, cancelled).
 */
const areWorkItemDependenciesMet = async (
  job: AgentJobDb,
  completedJobWorkItemIds: Set<string>,
): Promise<{ met: boolean; blockingWorkItemIds: string[] }> => {
  if (!job.workItemId) return { met: true, blockingWorkItemIds: [] };

  const deps = await getDependencies(job.workItemId);
  if (deps.length === 0) return { met: true, blockingWorkItemIds: [] };

  const blockingWorkItemIds: string[] = [];

  for (const dep of deps) {
    // If we already know this work item's job completed in the current session, skip.
    if (completedJobWorkItemIds.has(dep.blockedByWorkItemId)) continue;

    // Fetch the most recent job for the blocking work item.
    // listAgentJobs orders by createdAt DESC, so the first result is the latest.
    const { jobs: blockerJobs } = await listAgentJobs(
      { limit: 1, offset: 0 },
      { workspaceId: job.workspaceId!, workItemId: dep.blockedByWorkItemId },
    );

    const latestJob = blockerJobs[0];
    if (!latestJob) {
      // No job exists for the blocker -- treat as unblocked.
      continue;
    }

    if (latestJob.status !== "completed") {
      blockingWorkItemIds.push(dep.blockedByWorkItemId);
    }
  }

  return {
    met: blockingWorkItemIds.length === 0,
    blockingWorkItemIds,
  };
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createOrchestrator = (config: OrchestratorConfig): Orchestrator => {
  const {
    workerId,
    executeJob,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxConcurrentAgents = DEFAULT_MAX_CONCURRENT,
    postponeDelayMs = DEFAULT_POSTPONE_DELAY_MS,
  } = config;

  // -- Mutable state (captured in closures, not exposed directly) ----------
  const runningJobs = new Set<string>();
  const postponedJobs = new Set<string>();
  /** Work item ids whose jobs have completed during this orchestrator session. */
  const completedJobWorkItemIds = new Set<string>();

  // RAM budget
  const RUNNER_RAM_RESERVED_MB = Number(
    process.env.RUNNER_RAM_RESERVED_MB ?? "2048",
  );
  const hostTotalMb = Math.floor(os.totalmem() / (1024 * 1024));
  const ramBudgetMb = hostTotalMb - RUNNER_RAM_RESERVED_MB;

  // Track committed RAM per running job: jobId → memoryMb
  const jobMemoryMap = new Map<string, number>();

  const getRamCommittedMb = (): number => {
    let total = 0;
    for (const mb of jobMemoryMap.values()) total += mb;
    return total;
  };

  const getRamAvailableMb = (): number => ramBudgetMb - getRamCommittedMb();

  /** Compute how many ms have elapsed since the job's current startedAt. */
  const computeSegmentMs = (job: AgentJobDb): number =>
    job.startedAt instanceof Date
      ? Math.max(0, Date.now() - job.startedAt.getTime())
      : 0;

  let timer: ReturnType<typeof setInterval> | null = null;
  let tickInProgress = false;
  let stopRequested = false;
  let stopResolve: (() => void) | null = null;

  // -------------------------------------------------------------------
  // Core tick
  // -------------------------------------------------------------------

  const tick = async (): Promise<void> => {
    if (tickInProgress || stopRequested) return;
    tickInProgress = true;

    try {
      // Hard cap still applies
      if (runningJobs.size >= maxConcurrentAgents) return;

      // Claim one at a time, checking RAM budget after each
      while (runningJobs.size < maxConcurrentAgents) {
        if (getRamAvailableMb() <= 0) break;
        if (stopRequested) break;

        const claimed = await claimJobs(workerId, 1);
        if (claimed.length === 0) break;

        const job = claimed[0]!;
        const skillName = job.config?.skillName;
        const configuredMemory = job.config?.resourceEstimate?.estimatedMemoryMb;
        const memoryNeeded =
          typeof configuredMemory === "number" && Number.isFinite(configuredMemory) && configuredMemory > 0
            ? configuredMemory
            : getSkillMemoryMb(skillName);

        if (memoryNeeded > getRamAvailableMb()) {
          // Can't fit this job — release it back to queue
          const segmentMs = computeSegmentMs(job);
          const newCumulative = (job.cumulativeDurationMs ?? 0) + segmentMs;

          await updateJobStatus(job.id, "queued", {
            workerId: null,
            startedAt: null,
            cumulativeDurationMs: newCumulative,
          });
          logger.info(
            {
              jobId: job.id,
              skillName,
              memoryNeeded,
              ramAvailable: getRamAvailableMb(),
            },
            "Job released back to queue: insufficient RAM",
          );
          break;
        }

        // Track memory commitment
        jobMemoryMap.set(job.id, memoryNeeded);

        logger.debug(
          { workerId, jobId: job.id, skillName, memoryNeeded, ramAvailable: getRamAvailableMb() },
          "Orchestrator claimed job (RAM budget)",
        );

        // Check work-item-level dependencies
        const { met, blockingWorkItemIds } = await areWorkItemDependenciesMet(
          job,
          completedJobWorkItemIds,
        );

        if (!met) {
          // Postpone: revert to queued with a future availableAt.
          const postponeUntil = new Date(Date.now() + postponeDelayMs);
          const segmentMs = computeSegmentMs(job);
          const newCumulative = (job.cumulativeDurationMs ?? 0) + segmentMs;

          await updateJobStatus(job.id, "queued", {
            workerId: null,
            availableAt: postponeUntil,
            startedAt: null,
            cumulativeDurationMs: newCumulative,
          });

          // Release memory commitment for postponed job
          jobMemoryMap.delete(job.id);
          postponedJobs.add(job.id);

          logger.info(
            {
              jobId: job.id,
              workItemId: job.workItemId,
              blockingWorkItemIds,
              postponeUntil: postponeUntil.toISOString(),
            },
            "Job postponed -- dependencies not met",
          );
          continue;
        }

        // Dependencies satisfied -- the job is already "running" (set by claimJobs).
        runningJobs.add(job.id);
        postponedJobs.delete(job.id);

        logger.info(
          { jobId: job.id, workItemId: job.workItemId, skillName, memoryNeeded },
          "Job starting execution",
        );

        // Fire-and-forget: the consumer must call onJobCompleted/onJobFailed.
        executeJob(job).catch((err) => {
          logger.error(
            { jobId: job.id, err },
            "Unhandled error in executeJob callback",
          );
          onJobFailed(
            job.id,
            err instanceof Error ? err.message : String(err),
            "unhandled_callback_error",
          ).catch(() => {});
        });
      }
    } catch (err) {
      logger.error({ err }, "Orchestrator tick failed");
    } finally {
      tickInProgress = false;

      if (stopRequested && stopResolve) {
        stopResolve();
        stopResolve = null;
      }
    }
  };

  // -------------------------------------------------------------------
  // Re-evaluate postponed jobs after a dependency completes
  // -------------------------------------------------------------------

  const reevaluatePostponedDependents = async (
    completedWorkItemId: string,
    workspaceId: string,
  ): Promise<void> => {
    const dependentItems = await getDependents(completedWorkItemId);
    if (dependentItems.length === 0) return;

    const dependentWorkItemIds = new Set(
      dependentItems.map((d) => d.workItemId),
    );

    logger.debug(
      { completedWorkItemId, dependentCount: dependentWorkItemIds.size },
      "Re-evaluating dependents after job completion",
    );

    // Fetch all currently queued jobs in a single query.
    const { jobs: queuedJobs } = await listAgentJobs(
      { limit: 200, offset: 0 },
      { workspaceId, status: "queued" },
    );

    // Build a quick lookup of queued jobs that we have tracked as postponed.
    const queuedById = new Map(queuedJobs.map((j) => [j.id, j]));

    for (const postponedJobId of [...postponedJobs]) {
      const postponedJob = queuedById.get(postponedJobId);
      if (!postponedJob || !postponedJob.workItemId) continue;

      // Only touch jobs that are dependents of the just-completed work item.
      if (!dependentWorkItemIds.has(postponedJob.workItemId)) continue;

      // Clear the availableAt so it becomes immediately claimable.
      await updateJobStatus(postponedJob.id, "queued", {
        availableAt: null,
      });

      postponedJobs.delete(postponedJobId);

      logger.info(
        { jobId: postponedJobId, workItemId: postponedJob.workItemId },
        "Postponed job unblocked -- now claimable",
      );
    }
  };

  // -------------------------------------------------------------------
  // Quota/rate-limit resume helper
  // -------------------------------------------------------------------

  /**
   * Schedule a quota/rate-limit resume for a job.
   *
   * This puts the job back into "queued" with an `availableAt` in the future
   * and preserves the `sessionId` so the next execution can resume where it
   * left off. The `retryCount` is NOT incremented because quota pauses are
   * not real failures -- they should not consume the job's retry budget.
   *
   * Returns `true` if the resume was scheduled, `false` if the delay exceeds
   * the maximum retry window (caller should fail the job permanently).
   */
  const scheduleQuotaResume = async (
    jobId: string,
    sessionId: string | undefined,
    retryCount: number,
    delayMs: number,
    errorMessage: string,
    errorType: string,
  ): Promise<boolean> => {
    // If the raw delay already exceeds the max window, reject
    if (delayMs > MAX_RETRY_WINDOW_MS) {
      return false;
    }

    const effectiveDelay = Math.min(
      delayMs + QUOTA_RESUME_BUFFER_MS,
      MAX_RETRY_WINDOW_MS,
    );
    const availableAt = new Date(Date.now() + effectiveDelay);

    // Persist sessionId so the next claim gets it for resume.
    // This is done as a separate call to ensure sessionId is written even
    // if scheduleRetry below fails.
    if (sessionId) {
      try {
        await updateJobStatus(jobId, "queued", { sessionId });
      } catch (persistErr) {
        logger.debug(
          { jobId, err: persistErr },
          "Failed to persist sessionId for resume",
        );
      }
    }

    // Compute cumulative duration before re-queuing.
    const currentJob = await getJobById(jobId);
    const segmentMs = currentJob?.job.startedAt instanceof Date
      ? Math.max(0, Date.now() - currentJob.job.startedAt.getTime())
      : 0;
    const newCumulative = (currentJob?.job.cumulativeDurationMs ?? 0) + segmentMs;

    // Put the job back to "queued" with a future availableAt.
    // retryCount is preserved (not incremented) -- quota pauses are not failures.
    await updateJobStatus(jobId, "queued", {
      retryCount,
      availableAt,
      errorMessage,
      errorType,
      workerId: null,
      startedAt: null,
      cumulativeDurationMs: newCumulative,
    });

    // Track in the in-memory postponed set so the background timer can log
    // when the job becomes claimable again.
    postponedJobs.add(jobId);

    return true;
  };

  // -------------------------------------------------------------------
  // Job lifecycle callbacks
  // -------------------------------------------------------------------

  const onJobCompleted = async (jobId: string): Promise<void> => {
    runningJobs.delete(jobId);
    jobMemoryMap.delete(jobId);

    // Fetch the job to determine which work item it belongs to.
    const jobRecord = await getJobById(jobId);
    const workItemId = jobRecord?.job.workItemId ?? null;

    const now = new Date();
    const segmentMs = jobRecord?.job.startedAt instanceof Date
      ? Math.max(0, now.getTime() - jobRecord.job.startedAt.getTime())
      : 0;
    const totalDuration = (jobRecord?.job.cumulativeDurationMs ?? 0) + segmentMs;

    await updateJobStatus(jobId, "completed", {
      completedAt: now,
      durationMs: totalDuration > 0 ? totalDuration : undefined,
    });

    logger.info({ jobId, workItemId }, "Job completed");

    if (workItemId) {
      completedJobWorkItemIds.add(workItemId);
      const orgId = jobRecord?.job.workspaceId;
      if (orgId) {
        await reevaluatePostponedDependents(workItemId, orgId);
      }
    }
  };

  const onJobFailed = async (
    jobId: string,
    errorMessage: string,
    errorTypeOrOptions?: string | JobFailureOptions,
  ): Promise<void> => {
    runningJobs.delete(jobId);
    jobMemoryMap.delete(jobId);

    // Normalise the overloaded third argument
    const options: JobFailureOptions =
      typeof errorTypeOrOptions === "string"
        ? { errorType: errorTypeOrOptions }
        : errorTypeOrOptions ?? {};

    // Classify the error to determine retry strategy
    const classified = classifyError(errorMessage, options.errorType);

    // -----------------------------------------------------------------
    // Special handling: quota_exhausted / rate_limit
    // -----------------------------------------------------------------
    if (
      (classified.type === "quota_exhausted" ||
        classified.type === "rate_limit") &&
      classified.retryable
    ) {
      // Prefer explicit retryAfterMs from caller, fall back to classifier
      const delayMs =
        options.retryAfterMs ?? classified.retryAfterMs ?? 0;

      if (delayMs <= 0) {
        // No meaningful delay -- treat as a regular failure
        logger.warn(
          { jobId, errorType: classified.type, errorMessage },
          "Quota/rate-limit error with no retry delay -- failing permanently",
        );
        const now = new Date();
        await updateJobStatus(jobId, "failed", {
          failedAt: now,
          errorMessage: classified.message,
          errorType: classified.type,
        });
        return;
      }

      if (delayMs > MAX_RETRY_WINDOW_MS) {
        // Delay exceeds the 6-hour safety cap -- fail permanently
        logger.error(
          {
            jobId,
            delayMs,
            maxRetryWindowMs: MAX_RETRY_WINDOW_MS,
            errorType: classified.type,
          },
          "Job failed: retry window exceeds 6h maximum",
        );
        const now = new Date();
        await updateJobStatus(jobId, "failed", {
          failedAt: now,
          errorMessage: classified.message,
          errorType: classified.type,
        });
        return;
      }

      // Resolve sessionId: prefer caller-provided, then look up current job state
      let sessionForResume = options.sessionId;
      if (!sessionForResume) {
        try {
          const currentJob = await getJobById(jobId);
          sessionForResume = currentJob?.job.sessionId ?? undefined;
        } catch {
          // Best-effort -- proceed without sessionId
        }
      }

      const currentRetryCount =
        (await getJobById(jobId).then((j) => j?.job.retryCount)) ?? 0;

      const scheduled = await scheduleQuotaResume(
        jobId,
        sessionForResume,
        currentRetryCount,
        delayMs,
        classified.message,
        classified.type,
      );

      if (scheduled) {
        const delaySec = Math.round((delayMs + QUOTA_RESUME_BUFFER_MS) / 1_000);
        logger.info(
          {
            jobId,
            errorType: classified.type,
            delaySec,
            sessionId: sessionForResume ?? null,
          },
          `Job paused for quota/rate-limit resume in ${delaySec}s`,
        );
        return;
      }

      // scheduleQuotaResume returned false (should not happen given the
      // check above, but guard defensively)
      logger.error(
        { jobId, delayMs, errorType: classified.type },
        "scheduleQuotaResume rejected -- failing job permanently",
      );
      const now = new Date();
      await updateJobStatus(jobId, "failed", {
        failedAt: now,
        errorMessage: classified.message,
        errorType: classified.type,
      });
      return;
    }

    // -----------------------------------------------------------------
    // Generic retry for other retryable errors
    // -----------------------------------------------------------------
    if (classified.retryable) {
      const jobRecord = await getJobById(jobId);
      const currentRetryCount = jobRecord?.job.retryCount ?? 0;
      const maxRetries = jobRecord?.job.maxRetries ?? 2;

      if (currentRetryCount < maxRetries) {
        const nextRetryCount = currentRetryCount + 1;
        let delayMs: number;
        if (classified.retryAfterMs) {
          delayMs = classified.retryAfterMs;
        } else {
          const delaysMs = [30_000, 60_000, 120_000];
          delayMs = delaysMs[nextRetryCount - 1] ?? delaysMs[delaysMs.length - 1]!;
        }
        const availableAt = new Date(Date.now() + delayMs);

        const segmentMs = jobRecord?.job.startedAt instanceof Date
          ? Math.max(0, Date.now() - jobRecord.job.startedAt.getTime())
          : 0;
        const newCumulative = (jobRecord?.job.cumulativeDurationMs ?? 0) + segmentMs;

        logger.warn(
          {
            jobId,
            errorType: classified.type,
            retryCount: nextRetryCount,
            maxRetries,
            delayMs,
          },
          `Job failed (${classified.type}), retrying`,
        );

        await updateJobStatus(jobId, "queued", {
          retryCount: nextRetryCount,
          availableAt,
          errorMessage: classified.message,
          errorType: classified.type,
          workerId: null,
          startedAt: null,
          cumulativeDurationMs: newCumulative,
        });
        return;
      }
    }

    // -----------------------------------------------------------------
    // Permanent failure
    // -----------------------------------------------------------------
    const now = new Date();
    await updateJobStatus(jobId, "failed", {
      failedAt: now,
      errorMessage: classified.message,
      errorType: classified.type,
    });

    logger.warn(
      { jobId, errorMessage: classified.message, errorType: classified.type },
      "Job failed permanently",
    );
  };

  // -------------------------------------------------------------------
  // Background timer: quota-resume checker
  // -------------------------------------------------------------------

  let quotaResumeTimer: ReturnType<typeof setInterval> | null = null;
  let quotaResumeRunning = false;

  /**
   * Periodic check that cleans up the in-memory `postponedJobs` set for
   * quota-paused jobs whose `availableAt` has passed. The actual re-claim
   * happens via `claimJobs` (which filters on `available_at <= NOW`); this
   * timer only provides observability and keeps the in-memory set accurate.
   */
  const quotaResumeTick = async (): Promise<void> => {
    if (quotaResumeRunning || stopRequested) return;
    quotaResumeRunning = true;

    try {
      if (postponedJobs.size === 0) return;

      const now = new Date();
      const released: string[] = [];

      for (const jobId of [...postponedJobs]) {
        try {
          const record = await getJobById(jobId);
          if (!record) {
            // Job no longer exists -- remove from tracking
            postponedJobs.delete(jobId);
            continue;
          }

          const job = record.job;

          // If the job is no longer queued (e.g. it was cancelled or already
          // claimed), stop tracking it.
          if (job.status !== "queued") {
            postponedJobs.delete(jobId);
            continue;
          }

          // If availableAt has passed, the job is now claimable. Remove from
          // the postponed set so it can be picked up by the next tick.
          if (!job.availableAt || job.availableAt <= now) {
            postponedJobs.delete(jobId);
            released.push(jobId);
          }
        } catch (err) {
          logger.debug(
            { jobId, err },
            "Error checking postponed job status",
          );
        }
      }

      if (released.length > 0) {
        logger.info(
          { releasedCount: released.length, releasedJobIds: released },
          "Quota-postponed jobs now claimable",
        );
      }
    } finally {
      quotaResumeRunning = false;
    }
  };

  // -------------------------------------------------------------------
  // Start / Stop
  // -------------------------------------------------------------------

  const start = (): void => {
    if (timer) return;
    stopRequested = false;

    logger.info(
      { workerId, pollIntervalMs, maxConcurrentAgents, ramBudgetMb },
      "Orchestrator starting",
    );

    // Run first tick immediately, then at interval.
    tick();
    timer = setInterval(tick, pollIntervalMs);

    // Start the quota-resume background timer.
    quotaResumeTimer = setInterval(
      () => void quotaResumeTick(),
      QUOTA_RESUME_CHECK_INTERVAL_MS,
    );
  };

  const stop = (): Promise<void> => {
    stopRequested = true;

    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    if (quotaResumeTimer) {
      clearInterval(quotaResumeTimer);
      quotaResumeTimer = null;
    }

    if (tickInProgress) {
      return new Promise<void>((resolve) => {
        stopResolve = resolve;
      });
    }

    logger.info({ workerId }, "Orchestrator stopped");
    return Promise.resolve();
  };

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  return {
    start,
    stop,
    onJobCompleted,
    onJobFailed,
    getRunningJobs: () => runningJobs as ReadonlySet<string>,
    getPostponedJobs: () => postponedJobs as ReadonlySet<string>,
    getRamMetrics: () => ({
      ramBudgetMb,
      ramCommittedMb: getRamCommittedMb(),
      ramAvailableMb: getRamAvailableMb(),
    }),
  };
};
