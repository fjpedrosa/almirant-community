import {
  launchClusterInvestigation,
  getFeedbackClusterDetail,
  createJob,
  updateBugFixAttempt,
  markAttemptAsFailed,
  transitionCluster,
} from "@almirant/database";
import type { BugFixAttempt, FeedbackCluster } from "@almirant/database";
import { getAlmirantProjectId, logger } from "@almirant/config";
import { AUTOMATION_BOT_USER_ID } from "../../../shared/services/session-token";
import { broadcastAgentJobStatusChanged } from "../../../shared/ws/agent-job-events";
import { buildClusterInvestigationContext } from "../../feedback/services/cluster-investigation-context-builder";
import type { ClusterInvestigationContext } from "@almirant/shared";

export type LaunchInvestigationFailureCode =
  | "CLUSTER_NOT_FOUND"
  | "ACTIVE_ATTEMPT_EXISTS"
  | "MAX_ATTEMPTS_REACHED"
  | "INVALID_STATE"
  | "CLUSTER_EMPTY"
  | "INTERNAL";

export type LaunchInvestigationResult =
  | {
      success: true;
      attemptId: string;
      agentJobId: string;
      bugFixAttempt: BugFixAttempt;
      agentJob: Awaited<ReturnType<typeof createJob>>;
      cluster: FeedbackCluster;
    }
  | {
      success: false;
      code: LaunchInvestigationFailureCode;
      detail?: Record<string, unknown>;
      message: string;
    };

export interface LaunchInvestigationInput {
  clusterId: string;
  userId: string;
  workspaceId: string;
  domain?: "frontend" | "backend" | "coding-agent" | "infrastructure" | "unknown";
}

const ALLOWED_STATUSES = ["open", "resolved", "regression"] as const;

export const launchClusterInvestigationForUser = async (
  input: LaunchInvestigationInput,
): Promise<LaunchInvestigationResult> => {
  // projectId is hard-bound to the Almirant project — derived server-side,
  // no longer accepted from the request body.
  const almirantProjectId = getAlmirantProjectId();

  try {
    const result = await launchClusterInvestigation({
      clusterId: input.clusterId,
      userId: input.userId,
      projectId: almirantProjectId,
      workspaceId: input.workspaceId,
      domain: input.domain,
    });

    if (!result.success) {
      switch (result.reason) {
        case "cluster_not_found": {
          return {
            success: false,
            code: "CLUSTER_NOT_FOUND",
            message: "Feedback cluster not found",
          };
        }
        case "active_attempt_exists": {
          return {
            success: false,
            code: "ACTIVE_ATTEMPT_EXISTS",
            message: "An active investigation already exists for this cluster",
            detail: { activeAttemptId: result.activeAttemptId },
          };
        }
        case "invalid_state": {
          return {
            success: false,
            code: "INVALID_STATE",
            message: `Cluster is in a state that does not allow launching an investigation (current: ${result.currentStatus})`,
            detail: {
              currentStatus: result.currentStatus,
              allowedStatuses: [...ALLOWED_STATUSES],
            },
          };
        }
        case "cluster_empty": {
          return {
            success: false,
            code: "CLUSTER_EMPTY",
            message: "Cluster has no feedback items to investigate",
          };
        }
        case "max_attempts_reached": {
          return {
            success: false,
            code: "MAX_ATTEMPTS_REACHED",
            message:
              "Maximum number of bug-fix attempts reached for this cluster",
            detail: { budget: result.budget },
          };
        }
        default: {
          // Exhaustiveness guard.
          const _never: never = result;
          void _never;
          return {
            success: false,
            code: "INTERNAL",
            message: "Unknown launch-investigation failure",
          };
        }
      }
    }

    // Happy path: attempt + cluster transitioned. Now enqueue the agent
    // job and link it back to the attempt. Any failure here triggers
    // compensation.
    const { attempt, cluster } = result;

    // Best-effort: build the investigation context OUTSIDE the transaction,
    // BEFORE enqueueing the agent job. If anything throws, we log a warning
    // and enqueue the job without the context — the skill will fall back
    // to the legacy behavior (re-fetch on its own).
    let investigationContext: ClusterInvestigationContext | undefined;
    try {
      const detail = await getFeedbackClusterDetail(input.clusterId);
      if (detail) {
        // Find the freshly-created attempt inside the detail snapshot so
        // we pass the PR-enriched shape (`BugFixAttemptWithPr`). A brand
        // new attempt has `pr: null`; the builder still needs the right
        // shape to filter it out of `priorAttempts`.
        const currentAttemptFromDetail =
          detail.bugFixAttempts.find((a) => a.id === attempt.id) ?? {
            ...attempt,
            pr: null,
          };
        investigationContext = await buildClusterInvestigationContext({
          clusterId: input.clusterId,
          workspaceId: input.workspaceId,
          // projectId is hard-bound to the Almirant project.
          projectId: almirantProjectId,
          currentAttempt: currentAttemptFromDetail,
          cluster: detail.cluster,
          detail,
        });
      } else {
        logger.warn(
          { clusterId: input.clusterId, attemptId: attempt.id },
          "launch-investigation: getFeedbackClusterDetail returned null, skipping context"
        );
      }
    } catch (contextError) {
      investigationContext = undefined;
      logger.warn(
        {
          clusterId: input.clusterId,
          attemptId: attempt.id,
          error: contextError,
        },
        "launch-investigation: buildClusterInvestigationContext failed, continuing without context"
      );
    }

    logger.info(
      {
        clusterId: input.clusterId,
        contextSizeBytes: investigationContext?.truncation?.contextSizeBytes,
        truncationApplied: investigationContext?.truncation?.applied,
        errorSearchStatus: investigationContext?.errorSearchStatus,
      },
      "launch-investigation-context-built"
    );

    try {
      const job = await createJob({
        projectId: almirantProjectId,
        workspaceId: input.workspaceId,
        // Attribute the job to the automation bot so the runner can mint
        // an `mcp:internal` session token (see worker-session-token.routes.ts
        // bypass-proof guard). The admin who pressed "Launch investigation"
        // is preserved in config.requestedByUserId for audit and launcher UI.
        createdByUserId: AUTOMATION_BOT_USER_ID,
        // The cloud `agent_job_type` enum already includes "bug-analysis"
        // (see schema/enums.ts), so no cast is needed here.
        jobType: "bug-analysis",
        provider: "claude-code",
        priority: "medium",
        promptTemplate: "feedback-bug-analyze",
        prompt: attempt.id,
        triggerType: "event",
        config: {
          repoPath: "/workspace/repo",
          baseBranch: "main",
          projectId: almirantProjectId,
          bugFixAttemptId: attempt.id,
          domain: input.domain,
          feedbackItemId: result.primaryFeedbackItemId,
          clusterId: input.clusterId,
          requestedByUserId: input.userId,
          // Only include investigationContext when we actually built one —
          // avoids writing an explicit `undefined` into jsonb.
          ...(investigationContext ? { investigationContext } : {}),
        },
      });

      const linkedAttempt = await updateBugFixAttempt(attempt.id, {
        agentJobId: job.id,
      });

      broadcastAgentJobStatusChanged({
        workspaceId: job.workspaceId,
        jobId: job.id,
        status: job.status,
        workItemId: job.workItemId ?? null,
        planningSessionId: job.planningSessionId ?? null,
      });

      return {
        success: true,
        attemptId: attempt.id,
        agentJobId: job.id,
        bugFixAttempt: linkedAttempt ?? attempt,
        agentJob: job,
        cluster,
      };
    } catch (enqueueError) {
      const failureMessage =
        enqueueError instanceof Error
          ? enqueueError.message
          : String(enqueueError);

      logger.error(
        {
          clusterId: input.clusterId,
          attemptId: attempt.id,
          error: enqueueError,
        },
        "launch-investigation: enqueue/link failed, running compensation"
      );

      // Compensation 1: mark attempt as failed. This also has an internal
      // hook (A-1826) that transitions investigating→open if fixPrUrl is
      // null, but we still call transitionCluster below for belt-and-
      // braces idempotency against race conditions.
      try {
        await markAttemptAsFailed(attempt.id, "enqueue_failed", "system");
      } catch (markError) {
        logger.error(
          { attemptId: attempt.id, error: markError },
          "launch-investigation: markAttemptAsFailed during compensation failed"
        );
      }

      // Compensation 2: ensure the cluster is rolled back to `open`.
      // `transitionCluster` is idempotent on invalid_transition (e.g. if
      // the hook above already moved it), so we log warnings without
      // re-raising.
      try {
        const transition = await transitionCluster(input.clusterId, "open", {
          triggeredByKind: "system",
          triggeredByAttemptId: attempt.id,
          reason: "launch_compensation",
          metadata: { failureReason: failureMessage },
        });
        if (!transition.success) {
          logger.warn(
            {
              clusterId: input.clusterId,
              attemptId: attempt.id,
              reason: transition.reason,
            },
            "launch-investigation: compensation transitionCluster returned failure (likely idempotent)"
          );
        }
      } catch (transitionError) {
        logger.error(
          {
            clusterId: input.clusterId,
            attemptId: attempt.id,
            error: transitionError,
          },
          "launch-investigation: transitionCluster during compensation failed"
        );
      }

      return {
        success: false,
        code: "INTERNAL",
        message: "Failed to enqueue investigation job",
        detail: { failureReason: failureMessage },
      };
    }
  } catch (error) {
    logger.error(
      { clusterId: input.clusterId, error },
      "launch-investigation: unexpected failure"
    );
    return {
      success: false,
      code: "INTERNAL",
      message: "Failed to launch cluster investigation",
    };
  }
};
