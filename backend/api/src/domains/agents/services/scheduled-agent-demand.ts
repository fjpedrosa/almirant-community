import {
  getDefinitionOfDoneReviewCandidates,
  listEnabledScheduledAgentConfigs,
  previewBacklogDrainCandidates,
  type ScheduledAgentConfigDb,
} from "@almirant/database";
import { isScheduleDue } from "@almirant/shared";
import { logger } from "@almirant/config";

/**
 * Latent demand: work that a scheduled agent would pick up right now, but that
 * nobody has enqueued yet because no runner is alive to dispatch it.
 *
 * The scaler scales on queue depth, and the queue is filled by runners polling
 * `/workers/scheduled-configs`. With MIN_RUNNERS=0 that deadlocks: no runner
 * means no dispatch, no dispatch means no queued jobs, no queued jobs means the
 * scaler never boots a runner. Scheduled agents could then never fire — only
 * webhook-triggered ones, whose trigger comes from outside.
 *
 * Reporting this demand alongside the real queue depth breaks the cycle while
 * keeping scale-to-zero: a runner is booted only when there is actual work, not
 * merely because a cron tick came around. That distinction matters — these
 * agents typically run every five minutes, so "is it due?" is true nearly
 * always, and scaling on that alone would keep a runner up permanently.
 */

/** Only built-in automations have measurable pending work. */
const countPendingWork = async (config: ScheduledAgentConfigDb): Promise<number> => {
  const targetConfig = config.targetConfig ?? {};

  if (
    targetConfig.backlogDrain?.enabled === true ||
    targetConfig.dodRemediation?.enabled === true
  ) {
    const preview = await previewBacklogDrainCandidates({
      workspaceId: config.workspaceId,
      targetConfig,
      projectId: config.projectId,
      codingAgent: config.codingAgent,
      aiProvider: config.aiProvider,
      aiModel: config.aiModel,
      reasoningLevel: config.reasoningLevel,
    });
    return preview.candidates.length;
  }

  if (targetConfig.dodReview?.enabled === true) {
    const candidates = await getDefinitionOfDoneReviewCandidates(
      config.workspaceId,
      config.projectId ?? undefined,
      config.maxJobsPerRun,
      { minAgeMinutes: targetConfig.dodReview.minAgeMinutes },
    );
    return candidates.length;
  }

  // releaseIntegration has no read-only candidate selector — its queueing
  // endpoint writes as it reads — and prompt-style agents have no work items to
  // count. Both report zero, so they still rely on a runner being up for
  // another reason. Wiring release integration in needs a read-only selector
  // first.
  return 0;
};

export type ScheduledAgentDemand = {
  /** Total work items awaiting dispatch across every due agent. */
  totalPendingItems: number;
  /** How many agents are due AND have work — useful for logs. */
  agentsWithWork: number;
};

export const getScheduledAgentDemand = async (
  now: Date = new Date(),
): Promise<ScheduledAgentDemand> => {
  const configs = await listEnabledScheduledAgentConfigs();

  let totalPendingItems = 0;
  let agentsWithWork = 0;

  for (const config of configs) {
    // Webhook agents are triggered from outside; they never wait on a poll.
    if (config.trigger !== "scheduled") continue;
    if (config.pausedUntil && new Date(config.pausedUntil) > now) continue;
    if (!isScheduleDue(config, now)) continue;

    try {
      const pending = await countPendingWork(config);
      if (pending > 0) {
        totalPendingItems += pending;
        agentsWithWork += 1;
      }
    } catch (error) {
      // One bad config must not blind the scaler to the rest.
      logger.error(
        { error, scheduledConfigId: config.id, name: config.name },
        "Failed to measure latent demand for scheduled agent",
      );
    }
  }

  return { totalPendingItems, agentsWithWork };
};
