import type {
  FeedbackProcessor,
  FeedbackIngestInput,
  FeedbackIngestResult,
} from "@almirant/shared";
import { createFeedbackItem } from "@almirant/database";
import type { NewFeedbackItem } from "@almirant/database";

/**
 * Default FeedbackProcessor for the Community Edition.
 *
 * Persists feedback to the DB via the canonical repository helper.
 * Does NOT run the triage pipeline (classification, embedding, clustering).
 * CE self-hosted deployments typically do not need LLM-based clustering —
 * they get raw storage with a simple inbox UI.
 *
 * Enterprise Edition injects `enterpriseFeedbackProcessor`, which wraps this
 * persistence step plus enqueues the triage agent job.
 *
 * Field mapping (FeedbackIngestInput → feedback_items):
 *   - workspaceId → metadata.workspaceId  (feedback is mono-project)
 *   - projectId      → metadata.projectId       (audit only; Almirant-only)
 *   - title          → title                    (trimmed)
 *   - body           → content
 *   - category       → category                 (defaults to "other" when null)
 *   - userId         → metadata.userId          (no first-class author_user_id column)
 */
export const defaultFeedbackProcessor: FeedbackProcessor = {
  async ingest(input: FeedbackIngestInput): Promise<FeedbackIngestResult> {
    const data: Omit<NewFeedbackItem, "id" | "createdAt" | "updatedAt"> = {
      title: input.title.trim(),
      content: input.body,
      category:
        (input.category as NewFeedbackItem["category"]) ?? "other",
      metadata: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        userId: input.userId,
      },
    };
    const item = await createFeedbackItem(data);
    return { feedbackId: item.id, triaged: false };
  },
};
