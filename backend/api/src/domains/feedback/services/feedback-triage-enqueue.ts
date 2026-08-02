/**
 * Enqueues a feedback-triage agent job after a feedback item is created.
 *
 * Design decisions:
 * - Fire-and-forget by default: failures are logged but never propagate to the
 *   caller, so the feedback creation response is never blocked or broken.
 * - Idempotency: before inserting, we check for an existing active
 *   (queued/running) feedback-triage job with the same feedbackItemId in its
 *   config. If one exists, we skip creation and log a dedup notice.
 * - The function returns a result object so manual triggers (admin UI) can
 *   surface whether a job was actually enqueued or skipped for idempotency.
 */

import { createJob, db, agentJobs, and, eq, inArray, sql } from "@almirant/database";
import { logger, getAlmirantProjectId } from "@almirant/config";
import { broadcastAgentJobStatusChanged } from "../../../shared/ws/agent-job-events";

export type EnqueueFeedbackTriageResult =
  | { status: "enqueued"; jobId: string }
  | { status: "already_active" }
  | { status: "error"; error: string };

export type EnqueueFeedbackTriageBatchResult =
  | { status: "enqueued"; jobId: string }
  | { status: "already_active"; alreadyActiveJobId: string }
  | { status: "error"; error: string };

/**
 * Checks whether an active (queued or running) feedback-triage job already
 * exists for the given feedbackItemId. Uses a JSONB query on the config column.
 */
const hasActiveFeedbackTriageJob = async (feedbackItemId: string): Promise<boolean> => {
  const [row] = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.jobType, "feedback-triage"),
        inArray(agentJobs.status, ["queued", "running"]),
        sql`${agentJobs.config}->>'feedbackItemId' = ${feedbackItemId}`
      )
    )
    .limit(1);

  return !!row;
};

/**
 * Enqueues a feedback-triage job for the given feedback item.
 *
 * Safe to call multiple times for the same feedbackItemId -- duplicate jobs
 * are prevented by the idempotency check above.
 */
export const enqueueFeedbackTriageJob = async (params: {
  feedbackItemId: string;
  workspaceId: string;
}): Promise<EnqueueFeedbackTriageResult> => {
  try {
    // Idempotency guard: skip if an active job already exists for this item
    const alreadyQueued = await hasActiveFeedbackTriageJob(params.feedbackItemId);
    if (alreadyQueued) {
      logger.info(
        {
          event: "feedback_triage_enqueue_skipped",
          feedbackItemId: params.feedbackItemId,
        },
        "Feedback triage job already active for this item, skipping"
      );
      return { status: "already_active" };
    }

    const job = await createJob({
      workspaceId: params.workspaceId,
      projectId: getAlmirantProjectId(),
      jobType: "feedback-triage",
      provider: "claude-code",
      priority: "medium",
      promptTemplate: "feedback-triage",
      prompt: params.feedbackItemId,
      triggerType: "event",
      config: {
        feedbackItemId: params.feedbackItemId,
        repoPath: "",
        baseBranch: "",
      },
    });

    broadcastAgentJobStatusChanged({
      workspaceId: job.workspaceId,
      jobId: job.id,
      status: job.status,
      workItemId: job.workItemId ?? null,
      planningSessionId: job.planningSessionId ?? null,
    });

    logger.info(
      {
        event: "feedback_triage_enqueued",
        feedbackItemId: params.feedbackItemId,
        jobId: job.id,
      },
      "Feedback triage job enqueued"
    );
    return { status: "enqueued", jobId: job.id };
  } catch (error) {
    // Log but don't throw -- feedback creation must not fail because of this.
    // Never surface the raw caught error (issue #244): even though this
    // result is currently fire-and-forget (see feedback-item-service.ts),
    // it may embed raw SQL/driver detail, so keep the returned `error`
    // generic and log full detail server-side only.
    logger.error(
      {
        event: "feedback_triage_enqueue_failed",
        feedbackItemId: params.feedbackItemId,
        err: error,
      },
      "Failed to enqueue feedback triage job"
    );
    return { status: "error", error: "Failed to enqueue feedback triage job" };
  }
};

/**
 * Checks whether an active (queued or running) feedback-triage-batch job already
 * overlaps with any of the given feedbackItemIds. Uses the Postgres JSONB `?|`
 * operator over `config->'feedbackItemIds'` to detect any shared item id.
 *
 * Returns the id of the first overlapping active job, or null if none.
 */
const findActiveFeedbackTriageBatchOverlap = async (
  feedbackItemIds: string[]
): Promise<string | null> => {
  if (feedbackItemIds.length === 0) return null;
  const [row] = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.jobType, "feedback-triage-batch"),
        inArray(agentJobs.status, ["queued", "running"]),
        sql`${agentJobs.config}->'feedbackItemIds' ?| ARRAY[${sql.join(
          feedbackItemIds.map((id) => sql`${id}`),
          sql`, `
        )}]::text[]`
      )
    )
    .limit(1);

  return row?.id ?? null;
};

/**
 * Enqueues a feedback-triage-batch job for N feedback items in a single shot.
 *
 * Idempotency: if any of the given ids overlaps with an already-active
 * feedback-triage-batch job's `config.feedbackItemIds`, we skip creation and
 * return the already-active job id so the caller can surface the correct
 * state to the admin UI.
 *
 * Unlike the single-item helper, this one is called from an admin endpoint
 * where the caller wants to know the enqueue outcome, so we return a
 * discriminated union with an explicit `alreadyActiveJobId` on overlap.
 */
export const enqueueFeedbackTriageBatchJob = async (params: {
  feedbackItemIds: string[];
  workspaceId: string;
}): Promise<EnqueueFeedbackTriageBatchResult> => {
  const { feedbackItemIds, workspaceId } = params;

  try {
    if (feedbackItemIds.length < 2) {
      const error = "feedback_triage_batch_requires_at_least_two_items";
      logger.warn(
        {
          event: "feedback_triage_batch_enqueue_skipped",
          reason: error,
          itemCount: feedbackItemIds.length,
        },
        "Feedback triage batch enqueue rejected: batches require at least 2 items"
      );
      return { status: "error", error };
    }

    const alreadyActiveJobId = await findActiveFeedbackTriageBatchOverlap(feedbackItemIds);
    if (alreadyActiveJobId) {
      logger.info(
        {
          event: "feedback_triage_batch_enqueue_skipped",
          reason: "overlap_with_active_batch",
          feedbackItemIds,
          alreadyActiveJobId,
        },
        "Feedback triage batch job already active with overlapping ids, skipping"
      );
      return { status: "already_active", alreadyActiveJobId };
    }

    const job = await createJob({
      workspaceId,
      projectId: getAlmirantProjectId(),
      jobType: "feedback-triage-batch",
      provider: "claude-code",
      priority: "medium",
      skillName: "feedback-triage-batch",
      promptTemplate: "feedback-triage-batch",
      prompt: `/feedback-triage-batch ${feedbackItemIds.join(" ")}`,
      triggerType: "event",
      config: {
        feedbackItemIds,
        repoPath: "",
        baseBranch: "",
      },
    });

    broadcastAgentJobStatusChanged({
      workspaceId: job.workspaceId,
      jobId: job.id,
      status: job.status,
      workItemId: job.workItemId ?? null,
      planningSessionId: job.planningSessionId ?? null,
    });

    logger.info(
      {
        event: "feedback_triage_batch_enqueued",
        feedbackItemIds,
        jobId: job.id,
      },
      "Feedback triage batch job enqueued"
    );
    return { status: "enqueued", jobId: job.id };
  } catch (error) {
    // Never surface the raw caught error (issue #244): this result reaches
    // the HTTP client verbatim via POST /feedback-items/batch-triage, and a
    // raw DB/driver error may embed SQL, column names or bound params. Log
    // full detail server-side and return a generic message instead.
    logger.error(
      {
        event: "feedback_triage_batch_enqueue_failed",
        feedbackItemIds,
        err: error,
      },
      "Failed to enqueue feedback triage batch job"
    );
    return { status: "error", error: "Failed to enqueue feedback triage batch job" };
  }
};
