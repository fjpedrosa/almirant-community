import {
  expireInteractions,
  updateJobStatus,
  getJobById,
  cancelInteractionsByJobId,
  db,
  workItems,
  projects,
  eq,
} from "@almirant/database";
import type { ExpiredInteraction } from "@almirant/database";
import { wsConnectionManager } from "../../../shared/ws/ws-connection-manager";
import { logger } from "@almirant/config";

type InteractionTimeoutConfig = {
  intervalMs?: number;
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

const handleExpiredInteraction = async (interaction: ExpiredInteraction): Promise<void> => {
  const action = interaction.timeoutAction ?? "fail";
  const jobId = interaction.agentJobId;

  const job = await getJobById(jobId);
  if (!job) return;

  const orgId =
    job.job.workspaceId ??
    await resolveOrgIdFromWorkItem(interaction.workItemId ?? job.job.workItemId ?? null);
  if (orgId) {
    wsConnectionManager.broadcastToWorkspace(orgId, {
      type: "worker-interaction:expired",
      payload: {
        interactionId: interaction.id,
        jobId,
        workItemId: interaction.workItemId ?? "",
      },
    });
  }

  // Guard: do not flip a job that already finished successfully.
  // The sweeper can fire minutes after a job completes — overwriting a successful
  // completion with a failure status leaves the row in an inconsistent state
  // (status=failed, completed_at set, failed_at NULL).
  if (job.job.completedAt) {
    await cancelInteractionsByJobId(jobId);
    logger.info(
      { jobId, interactionId: interaction.id },
      "Interaction timeout: job already completed, discarding orphaned interaction"
    );
    return;
  }

  const isPlanningWaitingJob =
    job.job.planningSessionId !== null && job.job.status === "waiting_for_input";

  switch (action) {
    case "fail": {
      const now = new Date();
      const durationMs =
        job.job.startedAt instanceof Date
          ? Math.max(0, now.getTime() - job.job.startedAt.getTime())
          : null;

      // Cancel any remaining pending interactions for this job
      await cancelInteractionsByJobId(jobId);

      const updated = await updateJobStatus(jobId, "failed", {
        failedAt: now,
        durationMs: durationMs ?? undefined,
        errorType: "interaction-timeout",
        errorMessage: `Interaction timed out: "${interaction.questionText.slice(0, 100)}"`,
      });

      if (updated) {
        void broadcastStatusChanged({
          jobId: updated.id,
          status: updated.status,
          workItemId: updated.workItemId ?? null,
          workspaceId: orgId,
        });
        logger.warn(
          { jobId, interactionId: interaction.id },
          "Interaction timeout: job failed"
        );
      }
      break;
    }

    case "use_default": {
      if (isPlanningWaitingJob) {
        logger.info(
          { jobId, interactionId: interaction.id, planningSessionId: job.job.planningSessionId },
          "Interaction timeout: keeping planning job in waiting_for_input so the planning idle sweeper can close it"
        );
        break;
      }

      // Resume job with default answer — transition back to running
      const updated = await updateJobStatus(jobId, "running");
      if (updated) {
        void broadcastStatusChanged({
          jobId: updated.id,
          status: updated.status,
          workItemId: updated.workItemId ?? null,
          workspaceId: orgId,
        });
        logger.info(
          { jobId, interactionId: interaction.id, defaultAnswer: interaction.defaultAnswer },
          "Interaction timeout: using default answer, job resumed"
        );
      }
      break;
    }

    case "skip": {
      if (isPlanningWaitingJob) {
        logger.info(
          { jobId, interactionId: interaction.id, planningSessionId: job.job.planningSessionId },
          "Interaction timeout: keeping planning job in waiting_for_input so the planning idle sweeper can close it"
        );
        break;
      }

      // Resume job without an answer — transition back to running
      const updated = await updateJobStatus(jobId, "running");
      if (updated) {
        void broadcastStatusChanged({
          jobId: updated.id,
          status: updated.status,
          workItemId: updated.workItemId ?? null,
          workspaceId: orgId,
        });
        logger.info(
          { jobId, interactionId: interaction.id },
          "Interaction timeout: skipped, job resumed"
        );
      }
      break;
    }

    case "continue": {
      if (isPlanningWaitingJob) {
        logger.info(
          { jobId, interactionId: interaction.id, planningSessionId: job.job.planningSessionId },
          "Interaction timeout: keeping planning job in waiting_for_input so the planning idle sweeper can close it"
        );
        break;
      }

      // Legacy alias for "skip" — resume without an answer.
      // Older interaction creators used "continue" semantically meaning
      // "keep the job going after timeout". Treat identically to skip.
      const updated = await updateJobStatus(jobId, "running");
      if (updated) {
        void broadcastStatusChanged({
          jobId: updated.id,
          status: updated.status,
          workItemId: updated.workItemId ?? null,
          workspaceId: orgId,
        });
        logger.info(
          { jobId, interactionId: interaction.id },
          "Interaction timeout: legacy 'continue' treated as skip, job resumed"
        );
      }
      break;
    }

    default: {
      logger.warn(
        { jobId, interactionId: interaction.id, action },
        "Interaction timeout: unknown action, defaulting to fail"
      );
      await cancelInteractionsByJobId(jobId);
      const updated = await updateJobStatus(jobId, "failed", {
        errorType: "interaction-timeout",
        errorMessage: `Interaction timed out (unknown action: ${action})`,
      });
      if (updated) {
        void broadcastStatusChanged({
          jobId: updated.id,
          status: updated.status,
          workItemId: updated.workItemId ?? null,
          workspaceId: orgId,
        });
      }
    }
  }
};

export const runInteractionTimeoutOnce = async (): Promise<void> => {
  const expired = await expireInteractions();
  if (expired.length === 0) return;

  for (const interaction of expired) {
    try {
      await handleExpiredInteraction(interaction);
    } catch (err) {
      logger.error(
        { interactionId: interaction.id, err },
        "Interaction timeout sweeper: failed to handle expired interaction"
      );
    }
  }
};

export const startInteractionTimeoutSweeper = (cfg?: InteractionTimeoutConfig): (() => void) => {
  const intervalMs = cfg?.intervalMs ?? 30_000;

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runInteractionTimeoutOnce();
    } catch (err) {
      logger.error(
        { err },
        "Interaction timeout sweeper: tick failed (transient DB error, will retry next interval)"
      );
    } finally {
      running = false;
    }
  };

  // Run once shortly after boot (but don't block startup).
  setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
};
