/**
 * Application service that wraps `createFeedbackItem` from the repository.
 *
 * Keeps the repo layer pure (no side effects) and enqueues the triage agent
 * job as a fire-and-forget post-creation hook.
 *
 * Feedback is mono-project by definition (the Almirant project): there is no
 * `projectId` on feedback tables. Callers that need a project reference pull
 * it from `getAlmirantProjectId()` in `@almirant/config`.
 *
 * NOTE (CE→cloud port): the enterprise variant also invoked
 * `triggerDebugPipeline` from the `debug` domain. The cloud edition does not
 * ship the `debug` domain, so that hook is intentionally omitted here — the
 * triage-enqueue path below is the sole post-creation side effect.
 */

import type { NewFeedbackItem, FeedbackItem } from "@almirant/database";
import { createFeedbackItem } from "@almirant/database";
import { enqueueFeedbackTriageJob } from "./feedback-triage-enqueue";

export const createFeedbackItemWithPipeline = async (
  data: Omit<NewFeedbackItem, "id" | "createdAt" | "updatedAt">,
): Promise<FeedbackItem> => {
  const item = await createFeedbackItem(data);

  // Fire-and-forget: enqueue triage job without blocking the response
  const workspaceId = (item.metadata as Record<string, unknown> | null)?.workspaceId as string | undefined;
  if (workspaceId) {
    enqueueFeedbackTriageJob({ feedbackItemId: item.id, workspaceId }).catch(() => {
      // Already logged inside enqueueFeedbackTriageJob
    });
  }

  return item;
};
