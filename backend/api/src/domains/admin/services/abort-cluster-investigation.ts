/**
 * abortClusterInvestigation (A-1930)
 *
 * Reusable service that aborts an active investigation on a feedback cluster.
 * Shared between the manual admin endpoint
 * (`POST /feedback-clusters/:id/abort-investigation`) and the automatic
 * timeout sweeper.
 *
 * Guarantees (in order):
 *   1. Idempotent — calling twice on an already-open cluster returns
 *      `{ success: true, alreadyAborted: true }` instead of failing.
 *   2. Transitions cluster `investigating → open` with a properly-attributed
 *      `cluster_status_history` row (correct actor/reason based on caller).
 *   3. Marks the active `bug_fix_attempts` row as `failed` with the caller's
 *      reason (`aborted_by_user` | `aborted_by_timeout`).
 *   4. Best-effort cancels the linked `agent_jobs` row (logs on failure, never
 *      throws).
 *
 * ----------------------------------------------------------------------------
 * Ordering rationale — why we call `transitionCluster` BEFORE
 * `markAttemptAsFailed`:
 *
 * `markAttemptAsFailed` has an internal hook (A-1826) that, when
 * `cluster.status === "investigating"` and the attempt has no PR, auto-calls
 * `transitionCluster(..., "open", { triggeredByKind: "agent", reason:
 * "attempt_failed" })`. That actor/reason combination is WRONG for an
 * explicit user- or timeout-driven abort: the audit row would misattribute
 * the cause.
 *
 * Because `transitionCluster` short-circuits as a no-op when the current
 * status already equals the target (no new history row), we:
 *   (a) first call `transitionCluster` ourselves with the correct
 *       actor/reason — this writes the audit row we want, AND
 *   (b) then call `markAttemptAsFailed`. Since the cluster is already `open`,
 *       the hook's `cluster.status === "investigating"` guard is false, so
 *       the hook's own `transitionCluster` call is skipped entirely and no
 *       misattributed history row is appended.
 *
 * This keeps the audit trail clean without requiring changes to the
 * lower-level repository.
 */

import { logger } from "@almirant/config";
import {
  getFeedbackClusterById,
  transitionCluster,
  markAttemptAsFailed,
  getActiveAttemptForCluster,
  cancelJob,
  type BugFixAttempt,
  type FeedbackCluster,
  type ClusterStatusEnum,
} from "@almirant/database";
import { broadcastAgentJobStatusChanged } from "../../../shared/ws/agent-job-events";

export type AbortReason = "aborted_by_user" | "aborted_by_timeout";

export type AbortActor =
  | { kind: "user"; userId: string; workspaceId: string }
  | { kind: "system"; source: "timeout_sweeper"; workspaceId: string };

export type AbortResult =
  | { success: true; alreadyAborted: true; cluster: FeedbackCluster }
  | {
      success: true;
      alreadyAborted: false;
      attempt: BugFixAttempt | null;
      cluster: FeedbackCluster;
    }
  | { success: false; reason: "cluster_not_found" }
  | {
      success: false;
      reason: "invalid_state";
      currentStatus: ClusterStatusEnum;
    };

export const abortClusterInvestigation = async (args: {
  clusterId: string;
  reason: AbortReason;
  actor: AbortActor;
}): Promise<AbortResult> => {
  const { clusterId, reason, actor } = args;

  // (i) Fetch cluster
  const cluster = await getFeedbackClusterById(clusterId);
  if (!cluster) {
    return { success: false, reason: "cluster_not_found" };
  }

  // (ii) Idempotency: already open → success
  if (cluster.status === "open") {
    return { success: true, alreadyAborted: true, cluster };
  }

  // (iii) Only valid from `investigating`
  if (cluster.status !== "investigating") {
    return {
      success: false,
      reason: "invalid_state",
      currentStatus: cluster.status,
    };
  }

  // (iv) Find the active attempt (may be null if the row was deleted / never
  // linked; we still want to proceed with the cluster transition).
  const attempt = await getActiveAttemptForCluster(clusterId);

  const triggeredByUserId =
    actor.kind === "user" ? actor.userId : null;
  const metadata: Record<string, unknown> = {
    source: actor.kind === "system" ? actor.source : "manual",
  };

  // (v) Transition cluster FIRST with the correct actor/reason. See file-level
  // comment for why the ordering matters.
  const transition = await transitionCluster(clusterId, "open", {
    triggeredByKind: actor.kind,
    triggeredByUserId,
    triggeredByAttemptId: attempt?.id ?? null,
    reason,
    metadata,
  });

  if (!transition.success) {
    switch (transition.reason) {
      case "cluster_not_found":
        // Race: cluster was deleted between our fetch and the transition.
        return { success: false, reason: "cluster_not_found" };
      case "invalid_transition":
        return {
          success: false,
          reason: "invalid_state",
          currentStatus: transition.from,
        };
      default: {
        const _never: never = transition;
        void _never;
        return { success: false, reason: "cluster_not_found" };
      }
    }
  }

  // (vi) Mark the attempt as failed. The auto-hook inside markAttemptAsFailed
  // checks `cluster.status === "investigating"` — since we just moved it to
  // `open`, the hook is skipped and no misattributed history row is written.
  if (attempt) {
    try {
      await markAttemptAsFailed(attempt.id, reason, actor.kind);
    } catch (markError) {
      logger.error(
        { clusterId, attemptId: attempt.id, error: markError },
        "abort-cluster-investigation: markAttemptAsFailed failed"
      );
    }
  }

  // (vii) Best-effort agent-job cancel — never throws.
  if (attempt?.agentJobId) {
    try {
      const cancelled = await cancelJob(attempt.agentJobId);
      if (cancelled) {
        broadcastAgentJobStatusChanged({
          workspaceId: actor.workspaceId,
          jobId: attempt.agentJobId,
          status: cancelled.status,
          workItemId: null,
          planningSessionId: null,
        });
      }
    } catch (cancelError) {
      logger.warn(
        {
          clusterId,
          attemptId: attempt.id,
          agentJobId: attempt.agentJobId,
          error: cancelError,
        },
        "abort-cluster-investigation: best-effort agent-job cancel failed"
      );
    }
  }

  logger.info(
    {
      clusterId,
      attemptId: attempt?.id ?? null,
      reason,
      actor,
    },
    "cluster-investigation-aborted"
  );

  return {
    success: true,
    alreadyAborted: false,
    attempt,
    cluster: transition.cluster,
  };
};
