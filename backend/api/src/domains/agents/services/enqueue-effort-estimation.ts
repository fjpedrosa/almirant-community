import { logger } from "@almirant/config";
import {
  computeWorkItemContentHash,
  db,
  effortEstimationRequests,
  workItems,
  projects,
  eq,
} from "@almirant/database";
import { isFeatureFlagEnabled } from "../../../shared/services/posthog-service";

/**
 * Why a work item was enqueued for effort estimation (A-F-445).
 *
 * The reason is logged and may be stored on the queue row for observability,
 * but it does NOT affect dedup — dedup is driven by the partial unique index
 * on `effort_estimation_requests (work_item_id) WHERE status IN ('pending','processing')`.
 */
export type EffortEstimationReason =
  | "created"
  | "updated"
  | "child-added"
  | "child-removed"
  | "manual";

const FEATURE_FLAG_KEY = "effort-estimation-v1";

/**
 * Best-effort enqueue of an effort-estimation request for a work item.
 *
 * Behavior:
 *  - Resolves the work item (+ workspaceId via its project) and its direct child IDs.
 *  - Returns early if the item is missing or of type `idea` (ideas are not estimated).
 *  - Feature-gates via PostHog (`effort-estimation-v1`) keyed by the work item's
 *    organization. When the flag is disabled or PostHog is unconfigured the
 *    call is a no-op (fail-closed).
 *  - Computes the canonical content hash (title + description + type + parentId + childIds).
 *  - Inserts into `effort_estimation_requests` with `onConflictDoNothing()`:
 *    the partial unique index on (workItemId) WHERE status IN ('pending','processing')
 *    makes repeated enqueues for the same item a DB-level no-op while a prior
 *    request is still outstanding.
 *
 * This function never throws — failures are logged and swallowed so request
 * handlers can fire-and-forget (`.catch(() => {})`).
 */
export const enqueueEffortEstimation = async (
  workItemId: string,
  reason: EffortEstimationReason,
): Promise<void> => {
  try {
    const [row] = await db
      .select({
        id: workItems.id,
        title: workItems.title,
        description: workItems.description,
        type: workItems.type,
        parentId: workItems.parentId,
        workspaceId: projects.workspaceId,
      })
      .from(workItems)
      .leftJoin(projects, eq(projects.id, workItems.projectId))
      .where(eq(workItems.id, workItemId))
      .limit(1);

    if (!row) return;
    if (row.type === "idea") return;

    const orgKey = row.workspaceId ?? "unknown-org";
    const enabled = await isFeatureFlagEnabled(FEATURE_FLAG_KEY, orgKey);
    if (!enabled) return;

    const childRows = await db
      .select({ id: workItems.id })
      .from(workItems)
      .where(eq(workItems.parentId, workItemId));
    const childIds = childRows.map((c) => c.id);

    const contentHash = computeWorkItemContentHash({
      title: row.title,
      description: row.description,
      type: row.type,
      parentId: row.parentId,
      childIds,
    });

    await db
      .insert(effortEstimationRequests)
      .values({
        workItemId,
        status: "pending",
        requestedContentHash: contentHash,
      })
      .onConflictDoNothing();
  } catch (error) {
    logger.warn(
      { error, workItemId, reason },
      "enqueueEffortEstimation failed (fire-and-forget)",
    );
  }
};
