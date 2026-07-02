import { db } from "../../client";
import {
  feedbackClusters,
  feedbackPromotions,
  feedbackItems,
  workItems,
  boardColumns,
  clusterStatusHistory,
  feedbackClusterStatusEnum,
  bugFixAttempts,
  user,
} from "../../schema";
import { eq, and, asc, desc, sql, inArray, gte } from "drizzle-orm";
import type {
  FeedbackCluster,
  NewFeedbackCluster,
  FeedbackPromotion,
  NewFeedbackPromotion,
  ClusterStatusHistory,
  WorkItemDb,
  BugFixAttempt,
} from "../../schema";
import type {
  DebugContext,
  FeedbackWidgetSimpleMetadata,
  ClusterTimelineEvent,
  ClusterStatus,
} from "@almirant/shared";
import { ACTIVE_CLUSTER_STATUSES } from "@almirant/shared";
import { buildClusterTimeline } from "../../lib/cluster-timeline-builder";
import {
  buildClusterSummary,
  type ClusterSummary,
} from "../../lib/cluster-summary-builder";

// Re-export the summary types so downstream consumers (api routes, MCP
// tooling, tests) can import them from the same surface as `FeedbackClusterDetail`.
export type {
  ClusterSummary,
  ClusterLifecyclePhase,
  ClusterActiveAttemptSummary,
  ClusterIncidentKind,
  ClusterIncidentContext,
  ClusterLastChangeSummary,
  ClusterStatusValue,
} from "../../lib/cluster-summary-builder";
import type { PaginationParams } from "../../domain/types";
import type {
  TriageClusterTopicGroup,
  TriageClusterSummary,
  ClusterSampleItem,
  PromoteClusterRequest,
  PromoteClusterResponse,
} from "../../domain/feedback.types";
import { createWorkItem } from "../project-management/work-item-repository";
import type { WorkItemType, Priority } from "../../domain/types";
import {
  listBugFixAttemptsWithPrByFeedbackItem,
  listBugFixAttemptsWithPrByClusterOrItems,
  type BugFixAttemptWithPr,
} from "../agents/bug-fix-attempt-repository";

// --- Cluster operations ---

export interface FeedbackClusterFilters {
  statuses?: string[];
}

export const getFeedbackClusters = async (
  filters: FeedbackClusterFilters,
  pagination: PaginationParams
): Promise<{ clusters: FeedbackCluster[]; total: number }> => {
  const conditions = [];

  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push(
      inArray(
        feedbackClusters.status,
        filters.statuses as Array<typeof feedbackClusters.status.enumValues[number]>
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [clustersResult, countResult] = await Promise.all([
    db
      .select()
      .from(feedbackClusters)
      .where(whereClause)
      .orderBy(desc(feedbackClusters.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackClusters)
      .where(whereClause),
  ]);

  return {
    clusters: clustersResult,
    total: countResult[0]?.count ?? 0,
  };
};

export const getFeedbackClusterById = async (
  id: string
): Promise<FeedbackCluster | null> => {
  const [cluster] = await db
    .select()
    .from(feedbackClusters)
    .where(eq(feedbackClusters.id, id))
    .limit(1);

  return cluster ?? null;
};

export const createFeedbackCluster = async (
  data: Omit<NewFeedbackCluster, "id" | "createdAt" | "updatedAt">
): Promise<FeedbackCluster> => {
  const [newCluster] = await db
    .insert(feedbackClusters)
    .values(data)
    .returning();

  if (!newCluster) throw new Error("Failed to create feedback cluster");
  return newCluster;
};

export const updateFeedbackCluster = async (
  id: string,
  data: Partial<Pick<NewFeedbackCluster, "title" | "summary" | "itemCount" | "status" | "suggestedType" | "suggestedPriority" | "metadata">>
): Promise<FeedbackCluster | null> => {
  const [updated] = await db
    .update(feedbackClusters)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(feedbackClusters.id, id))
    .returning();

  return updated ?? null;
};

export const deleteFeedbackCluster = async (id: string): Promise<boolean> => {
  const result = await db
    .delete(feedbackClusters)
    .where(eq(feedbackClusters.id, id))
    .returning({ id: feedbackClusters.id });

  return result.length > 0;
};

// --- Cluster count & batch operations ---

/**
 * Count the actual number of feedback items linked to a cluster.
 * This is the source of truth, not the cached `itemCount` field.
 */
export const getClusterItemCount = async (clusterId: string): Promise<number> => {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(feedbackItems)
    .where(eq(feedbackItems.clusterId, clusterId));

  return result?.count ?? 0;
};

/**
 * Recalculate and persist the `itemCount` for a single cluster based on
 * the actual number of linked feedback items in the database.
 *
 * Returns the recalculated count.
 */
export const recalculateClusterItemCount = async (clusterId: string): Promise<number> => {
  const actualCount = await getClusterItemCount(clusterId);

  await db
    .update(feedbackClusters)
    .set({ itemCount: actualCount, updatedAt: new Date() })
    .where(eq(feedbackClusters.id, clusterId));

  return actualCount;
};

/**
 * Recalculate `itemCount` for **all** open clusters in a project.
 * Useful after a triage re-run to ensure every cluster reflects reality.
 *
 * Uses a single SQL subquery-based UPDATE for efficiency instead of N+1 queries.
 */
export const recalculateAllClusterCounts = async (): Promise<void> => {
  await db.execute(sql`
    UPDATE feedback_clusters fc
    SET item_count = (
      SELECT count(*)::int
      FROM feedback_items fi
      WHERE fi.cluster_id = fc.id
    ),
    updated_at = now()
    WHERE fc.status = 'open'
  `);
};

/**
 * Batch-assign multiple feedback items to a cluster in a single UPDATE.
 * Optionally transitions their status (e.g. "new" -> "triaged").
 *
 * Returns the number of rows actually updated.
 */
export const batchAssignItemsToCluster = async (
  itemIds: string[],
  clusterId: string,
  newStatus?: string
): Promise<number> => {
  if (itemIds.length === 0) return 0;

  const setClause: Record<string, unknown> = {
    clusterId,
    updatedAt: new Date(),
  };

  if (newStatus) {
    setClause.status = newStatus;
  }

  const result = await db
    .update(feedbackItems)
    .set(setClause)
    .where(inArray(feedbackItems.id, itemIds))
    .returning({ id: feedbackItems.id });

  return result.length;
};

/**
 * Get all feedback items linked to a specific cluster.
 * Returns lightweight projections (id, title, content) for summary regeneration.
 */
export const getClusterItems = async (
  clusterId: string
): Promise<{ id: string; title: string; content: string | null }[]> => {
  return db
    .select({
      id: feedbackItems.id,
      title: feedbackItems.title,
      content: feedbackItems.content,
    })
    .from(feedbackItems)
    .where(eq(feedbackItems.clusterId, clusterId));
};

// --- Triage: clusters grouped by topic (G2) ---

/**
 * Parameters for `listClusters`.
 *
 * - `workspaceId`: accepted for future multi-tenant scoping. The
 *   `feedback_clusters` table does not yet carry an `workspace_id` column,
 *   so the value is currently NOT applied as a WHERE clause; callers that
 *   need tenant isolation must compose it at a higher layer. Kept in the
 *   signature so the contract does not break when the column is added.
 * - `statuses`: statuses to include. When omitted or empty, defaults to
 *   `ACTIVE_CLUSTER_STATUSES`. Invalid enum values are silently filtered out
 *   so malformed query-string input cannot reach Postgres and trigger a 500
 *   via `invalid input value for enum`.
 * - `minItemCount`: inclusive lower bound on `itemCount`. Defaults to 1 so
 *   clusters with zero linked items (e.g. freshly-created clusters awaiting
 *   the first item) are hidden from the triage list.
 * - `sortBy`: primary order. `"updatedAt"` (default) orders by recency of the
 *   last change, matching the admin triage UI which surfaces the freshest
 *   clusters first. `"itemCount"` orders by impact; `"createdAt"` orders by
 *   creation time. In every case the other columns are used as secondary
 *   DESC tiebreakers so the ordering is deterministic.
 */
export interface ListClustersParams {
  workspaceId: string;
  statuses?: readonly ClusterStatus[];
  minItemCount?: number;
  sortBy?: "itemCount" | "createdAt" | "updatedAt";
}

/**
 * List clusters grouped by topic, ordered by impact or recency.
 *
 * Since the feedback_topics table does NOT exist yet, all clusters are returned
 * under a single group with `topic: null`.
 *
 * Sample items (up to 3 per cluster) are fetched in a single query using a
 * window function to avoid N+1.
 *
 * Renamed from `listOpenClustersGroupedByTopic` (A-1882) to reflect the
 * widened status filter — the function no longer hard-codes `status = 'open'`.
 */
/**
 * Pure resolver for `listClusters` parameters. Exposed separately so the unit
 * suite can exercise the defaulting rules (A-F-437) without spinning up a
 * Postgres instance.
 *
 * Rules:
 *   - Unknown enum values are silently dropped (the HTTP route is responsible
 *     for 400-ing on unknown input; at the repo layer we still defensively
 *     filter so callers that build params programmatically don't hit a
 *     Postgres `invalid input value for enum` 500).
 *   - When no valid status remains, fall back to `ACTIVE_CLUSTER_STATUSES`.
 *   - `minItemCount` defaults to 1 and is clamped to a strict positive.
 *   - `sortBy` defaults to `"updatedAt"` (A-F-437) — the triage UI sorts by
 *     recency so freshly-changed clusters surface first.
 */
export const resolveListClustersParams = (
  params: ListClustersParams
): {
  statuses: readonly ClusterStatus[];
  minItemCount: number;
  sortBy: "itemCount" | "createdAt" | "updatedAt";
} => {
  const validStatusValues = feedbackClusters.status
    .enumValues as readonly string[];
  const requestedStatuses = (params.statuses ?? []).filter((s) =>
    validStatusValues.includes(s)
  );
  const statuses: readonly ClusterStatus[] =
    requestedStatuses.length > 0 ? requestedStatuses : ACTIVE_CLUSTER_STATUSES;

  const minItemCount =
    params.minItemCount !== undefined && params.minItemCount > 0
      ? params.minItemCount
      : 1;

  const sortBy: "itemCount" | "createdAt" | "updatedAt" =
    params.sortBy ?? "updatedAt";

  return { statuses, minItemCount, sortBy };
};

/**
 * Drizzle ORDER BY columns for a given sort key. Pure so the unit suite can
 * assert on the primary / tiebreaker column names without hitting the DB.
 */
export const buildListClustersOrderBy = (
  sortBy: "itemCount" | "createdAt" | "updatedAt"
) => {
  if (sortBy === "createdAt") {
    return [desc(feedbackClusters.createdAt), desc(feedbackClusters.itemCount)];
  }
  if (sortBy === "updatedAt") {
    return [desc(feedbackClusters.updatedAt), desc(feedbackClusters.itemCount)];
  }
  return [desc(feedbackClusters.itemCount), desc(feedbackClusters.createdAt)];
};

export const listClusters = async (
  params: ListClustersParams,
  pagination: PaginationParams
): Promise<{ groups: TriageClusterTopicGroup[]; total: number }> => {
  // Ignore the parameter for now (see doc comment) — referenced so TS does
  // not flag it as unused while the column lands in a follow-up migration.
  void params.workspaceId;

  const { statuses, minItemCount, sortBy } = resolveListClustersParams(params);

  const conditions = [
    inArray(
      feedbackClusters.status,
      statuses as Array<typeof feedbackClusters.status.enumValues[number]>
    ),
    gte(feedbackClusters.itemCount, minItemCount),
  ];

  const whereClause = and(...conditions);

  // Order clause: primary + secondary DESC tiebreaker so the ordering is
  // deterministic regardless of which key was requested.
  const orderByClause = buildListClustersOrderBy(sortBy);

  // 1. Fetch paginated clusters + total count in parallel
  const [clustersResult, countResult] = await Promise.all([
    db
      .select({
        id: feedbackClusters.id,
        title: feedbackClusters.title,
        summary: feedbackClusters.summary,
        itemCount: feedbackClusters.itemCount,
        suggestedType: feedbackClusters.suggestedType,
        suggestedPriority: feedbackClusters.suggestedPriority,
        createdAt: feedbackClusters.createdAt,
        status: feedbackClusters.status,
        updatedAt: feedbackClusters.updatedAt,
      })
      .from(feedbackClusters)
      .where(whereClause)
      .orderBy(...orderByClause)
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackClusters)
      .where(whereClause),
  ]);

  const total = countResult[0]?.count ?? 0;

  if (clustersResult.length === 0) {
    return {
      groups: [{ topic: null, clusters: [] }],
      total,
    };
  }

  // 2. Fetch up to 3 sample items per cluster in a single query.
  //    Uses ROW_NUMBER() window function partitioned by cluster_id to pick the
  //    3 most recent items per cluster, avoiding N+1.
  const clusterIds = clustersResult.map((c) => c.id);

  // Build IN (...) with individual params because Drizzle's sql template
  // flattens JS arrays into a record `($1, $2, ...)` instead of a SQL array,
  // which breaks `ANY(...)`. Using IN with sql.join keeps the query parameterized
  // while avoiding the tuple-vs-array mismatch.
  const clusterIdsSql = sql.join(
    clusterIds.map((id) => sql`${id}`),
    sql`, `
  );
  const sampleRows = await db.execute(sql`
    SELECT cluster_id, id, title, author_name
    FROM (
      SELECT
        fi.cluster_id,
        fi.id,
        fi.title,
        fi.author_name,
        ROW_NUMBER() OVER (PARTITION BY fi.cluster_id ORDER BY fi.created_at DESC) AS rn
      FROM feedback_items fi
      WHERE fi.cluster_id IN (${clusterIdsSql})
    ) ranked
    WHERE rn <= 3
  `) as unknown as Array<{
    cluster_id: string;
    id: string;
    title: string;
    author_name: string | null;
  }>;

  // 3. Group sample items by cluster id
  const samplesByCluster = new Map<string, ClusterSampleItem[]>();
  for (const row of sampleRows) {
    const items = samplesByCluster.get(row.cluster_id) ?? [];
    items.push({
      id: row.id,
      title: row.title,
      authorName: row.author_name,
    });
    samplesByCluster.set(row.cluster_id, items);
  }

  // 4. Build the response: a single topic-null group
  const clusters: TriageClusterSummary[] = clustersResult.map((c) => ({
    id: c.id,
    title: c.title,
    summary: c.summary,
    itemCount: c.itemCount,
    suggestedType: c.suggestedType,
    suggestedPriority: c.suggestedPriority,
    sampleItems: samplesByCluster.get(c.id) ?? [],
    createdAt: c.createdAt,
    status: c.status as ClusterStatus,
    updatedAt: c.updatedAt,
  }));

  return {
    groups: [{ topic: null, clusters }],
    total,
  };
};

// --- Promotion operations ---

export interface FeedbackPromotionWithRelations extends FeedbackPromotion {
  feedbackItem?: { id: string; title: string; status: string } | null;
  workItem?: { id: string; title: string; taskId: string | null } | null;
}

export const getFeedbackPromotions = async (
  feedbackItemId?: string,
  workItemId?: string
): Promise<FeedbackPromotionWithRelations[]> => {
  const conditions = [];

  if (feedbackItemId) {
    conditions.push(eq(feedbackPromotions.feedbackItemId, feedbackItemId));
  }
  if (workItemId) {
    conditions.push(eq(feedbackPromotions.workItemId, workItemId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      promotion: feedbackPromotions,
      feedbackTitle: feedbackItems.title,
      feedbackStatus: feedbackItems.status,
      workItemTitle: workItems.title,
      workItemTaskId: workItems.taskId,
    })
    .from(feedbackPromotions)
    .leftJoin(feedbackItems, eq(feedbackPromotions.feedbackItemId, feedbackItems.id))
    .leftJoin(workItems, eq(feedbackPromotions.workItemId, workItems.id))
    .where(whereClause)
    .orderBy(desc(feedbackPromotions.createdAt));

  return results.map((row) => ({
    ...row.promotion,
    feedbackItem: row.feedbackTitle
      ? { id: row.promotion.feedbackItemId, title: row.feedbackTitle, status: row.feedbackStatus ?? "" }
      : null,
    workItem: row.workItemTitle
      ? { id: row.promotion.workItemId, title: row.workItemTitle, taskId: row.workItemTaskId }
      : null,
  }));
};

export const createFeedbackPromotion = async (
  data: Omit<NewFeedbackPromotion, "id" | "createdAt">
): Promise<FeedbackPromotion> => {
  const [newPromotion] = await db
    .insert(feedbackPromotions)
    .values(data)
    .returning();

  if (!newPromotion) throw new Error("Failed to create feedback promotion");
  return newPromotion;
};

export const getFeedbackPromotionByFeedbackItem = async (
  feedbackItemId: string
): Promise<FeedbackPromotion | null> => {
  const [promotion] = await db
    .select()
    .from(feedbackPromotions)
    .where(eq(feedbackPromotions.feedbackItemId, feedbackItemId))
    .limit(1);

  return promotion ?? null;
};

export const getFeedbackPromotionByWorkItem = async (
  workItemId: string
): Promise<FeedbackPromotion | null> => {
  const [promotion] = await db
    .select()
    .from(feedbackPromotions)
    .where(eq(feedbackPromotions.workItemId, workItemId))
    .limit(1);

  return promotion ?? null;
};

// --- Traceability query ---

export interface FeedbackTraceabilityRow {
  feedbackItem: {
    id: string;
    title: string;
    status: string;
    category: string;
    createdAt: Date;
  };
  promotion: {
    id: string;
    promotedBy: string | null;
    notes: string | null;
    createdAt: Date;
  } | null;
  workItem: {
    id: string;
    title: string;
    taskId: string | null;
    type: string;
    priority: string;
    columnName: string;
  } | null;
  bugFixAttempts: BugFixAttemptWithPr[];
}

export const getFeedbackTraceability = async (
  feedbackItemId: string
): Promise<FeedbackTraceabilityRow | null> => {
  const [feedbackRow] = await db
    .select()
    .from(feedbackItems)
    .where(eq(feedbackItems.id, feedbackItemId))
    .limit(1);

  if (!feedbackRow) return null;

  // Run promotion query and bug fix attempts in parallel
  const [promotionRow, bugFixAttemptsResult] = await Promise.all([
    db
      .select({
        promotion: feedbackPromotions,
        workItemTitle: workItems.title,
        workItemTaskId: workItems.taskId,
        workItemType: workItems.type,
        workItemPriority: workItems.priority,
        columnName: boardColumns.name,
      })
      .from(feedbackPromotions)
      .leftJoin(workItems, eq(feedbackPromotions.workItemId, workItems.id))
      .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
      .where(eq(feedbackPromotions.feedbackItemId, feedbackItemId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    listBugFixAttemptsWithPrByFeedbackItem(feedbackItemId),
  ]);

  return {
    feedbackItem: {
      id: feedbackRow.id,
      title: feedbackRow.title,
      status: feedbackRow.status,
      category: feedbackRow.category,
      createdAt: feedbackRow.createdAt,
    },
    promotion: promotionRow
      ? {
          id: promotionRow.promotion.id,
          promotedBy: promotionRow.promotion.promotedBy,
          notes: promotionRow.promotion.notes,
          createdAt: promotionRow.promotion.createdAt,
        }
      : null,
    workItem: promotionRow?.workItemTitle
      ? {
          id: promotionRow.promotion.workItemId,
          title: promotionRow.workItemTitle,
          taskId: promotionRow.workItemTaskId,
          type: promotionRow.workItemType ?? "task",
          priority: promotionRow.workItemPriority ?? "medium",
          columnName: promotionRow.columnName ?? "",
        }
      : null,
    bugFixAttempts: bugFixAttemptsResult,
  };
};

// --- Cluster promotion ---

/**
 * Promote an entire cluster to a single work item.
 *
 * Steps:
 *  1. Fetch cluster; throw if not found.
 *  2. Idempotency: if the cluster is already "promoted", look up the existing
 *     work item via feedback_promotions and return it (HTTP 200 compatible).
 *  3. Create the work_item via `createWorkItem` (uses `db` internally, cannot
 *     run inside our tx — accepted trade-off; see cleanup below).
 *  4. In a single transaction:
 *     a. Link every feedback_item in the cluster (set promotedWorkItemId).
 *     b. Insert one feedback_promotion per linked item.
 *     c. Set cluster status to "promoted".
 *  5. If the tx fails, attempt to delete the orphaned work item (best-effort).
 *
 * Returns the created work item, a representative promotion, and count.
 */
export const promoteClusterToWorkItem = async (
  request: PromoteClusterRequest
): Promise<PromoteClusterResponse & { alreadyPromoted: boolean }> => {
  const {
    clusterId,
    workspaceId,
    boardId,
    boardColumnId,
    workItemType,
    priority,
    parentWorkItemId,
    titleOverride,
    notes,
    promotedBy,
    createdByUserId,
    projectId,
  } = request;

  // 1. Fetch the cluster
  const cluster = await getFeedbackClusterById(clusterId);
  if (!cluster) {
    throw new Error("CLUSTER_NOT_FOUND: Feedback cluster does not exist");
  }

  // 2. Idempotency: if cluster is already promoted, return existing data
  if (cluster.status === "promoted") {
    const existingPromotion = await findFirstPromotionForCluster(clusterId);
    if (existingPromotion) {
      const [existingWorkItem] = await db
        .select({
          id: workItems.id,
          title: workItems.title,
          taskId: workItems.taskId,
          type: workItems.type,
        })
        .from(workItems)
        .where(eq(workItems.id, existingPromotion.workItemId))
        .limit(1);

      if (existingWorkItem) {
        const linkedCount = await getClusterItemCount(clusterId);
        return {
          workItem: {
            id: existingWorkItem.id,
            title: existingWorkItem.title,
            taskId: existingWorkItem.taskId,
            type: existingWorkItem.type,
          },
          promotion: {
            id: existingPromotion.id,
            feedbackItemId: existingPromotion.feedbackItemId,
            workItemId: existingPromotion.workItemId,
            createdAt: existingPromotion.createdAt,
          },
          linkedItemCount: linkedCount,
          alreadyPromoted: true,
        };
      }
    }
  }

  // 3. Get cluster items
  const clusterItemRows = await getClusterItems(clusterId);
  if (clusterItemRows.length === 0) {
    throw new Error("CLUSTER_EMPTY: Cluster has no feedback items to promote");
  }

  // 4. Build work item title and description
  const title = titleOverride || cluster.title;
  const description = cluster.summary
    ? `${cluster.summary}\n\n---\nPromoted from feedback cluster with ${clusterItemRows.length} item(s).`
    : `Promoted from feedback cluster with ${clusterItemRows.length} item(s).`;

  // 5. Create the work item (outside tx because createWorkItem uses db internally)
  const newWorkItem = await createWorkItem(
    workspaceId,
    {
      boardId,
      boardColumnId: boardColumnId ?? null,
      type: (workItemType ?? cluster.suggestedType ?? "task") as WorkItemType,
      title,
      description,
      priority: (priority ?? cluster.suggestedPriority ?? "medium") as Priority,
      parentId: parentWorkItemId,
      createdByUserId,
      projectId: projectId ?? undefined,
      metadata: {
        promotedFromCluster: clusterId,
        feedbackItemCount: clusterItemRows.length,
      },
    },
    {
      triggeredBy: "user",
      triggeredByUserId: createdByUserId,
    }
  );

  // 6. In a transaction: link items, create promotions, update cluster
  try {
    const promotionRows = await db.transaction(async (tx) => {
      // a. Link all feedback items to the new work item
      const itemIds = clusterItemRows.map((item) => item.id);
      await tx
        .update(feedbackItems)
        .set({
          promotedWorkItemId: newWorkItem.id,
          status: "triaged" as const,
          updatedAt: new Date(),
        })
        .where(inArray(feedbackItems.id, itemIds));

      // b. Insert one feedback_promotion per linked item
      const promotionValues = clusterItemRows.map((item) => ({
        feedbackItemId: item.id,
        workItemId: newWorkItem.id,
        promotedBy,
        notes: notes ?? null,
        metadata: { clusterId } as Record<string, unknown>,
      }));

      const insertedPromotions = await tx
        .insert(feedbackPromotions)
        .values(promotionValues)
        .returning();

      // c. Mark cluster as promoted
      await tx
        .update(feedbackClusters)
        .set({
          status: "promoted" as const,
          updatedAt: new Date(),
        })
        .where(eq(feedbackClusters.id, clusterId));

      return insertedPromotions;
    });

    const firstPromotion = promotionRows[0]!;

    return {
      workItem: {
        id: newWorkItem.id,
        title: newWorkItem.title,
        taskId: newWorkItem.taskId,
        type: newWorkItem.type,
      },
      promotion: {
        id: firstPromotion.id,
        feedbackItemId: firstPromotion.feedbackItemId,
        workItemId: firstPromotion.workItemId,
        createdAt: firstPromotion.createdAt,
      },
      linkedItemCount: clusterItemRows.length,
      alreadyPromoted: false,
    };
  } catch (txError) {
    // Best-effort cleanup: delete the orphaned work item
    try {
      await db
        .delete(workItems)
        .where(eq(workItems.id, newWorkItem.id));
    } catch {
      // Cleanup failure is non-fatal; the orphaned work item can be cleaned up later
    }
    throw txError;
  }
};

/**
 * Find the first promotion record linked to any feedback item in a cluster.
 * Used for idempotency checks on already-promoted clusters.
 */
const findFirstPromotionForCluster = async (
  clusterId: string
): Promise<FeedbackPromotion | null> => {
  const [promotion] = await db
    .select({
      promotion: feedbackPromotions,
    })
    .from(feedbackPromotions)
    .innerJoin(feedbackItems, eq(feedbackPromotions.feedbackItemId, feedbackItems.id))
    .where(eq(feedbackItems.clusterId, clusterId))
    .orderBy(desc(feedbackPromotions.createdAt))
    .limit(1);

  return promotion?.promotion ?? null;
};

/**
 * Variant of `findFirstPromotionForCluster` that also returns the linked
 * work item (if any). Uses a LEFT JOIN so a promotion whose work item was
 * deleted still surfaces as `{ promotion, workItem: null }`.
 *
 * Used by `getFeedbackClusterDetail` to hydrate the cluster-detail modal
 * with both the promotion record and the work-item it was promoted to.
 */
const findFirstPromotionForClusterWithWorkItem = async (
  clusterId: string
): Promise<{ promotion: FeedbackPromotion; workItem: WorkItemDb | null } | null> => {
  const [row] = await db
    .select({
      promotion: feedbackPromotions,
      workItem: workItems,
    })
    .from(feedbackPromotions)
    .innerJoin(feedbackItems, eq(feedbackPromotions.feedbackItemId, feedbackItems.id))
    .leftJoin(workItems, eq(feedbackPromotions.workItemId, workItems.id))
    .where(eq(feedbackItems.clusterId, clusterId))
    .orderBy(desc(feedbackPromotions.createdAt))
    .limit(1);

  if (!row) return null;

  return {
    promotion: row.promotion,
    workItem: row.workItem ?? null,
  };
};

// --- Cluster detail (aggregate for modal) ---

/**
 * Statuses considered "in-flight" for a bug fix attempt. The cluster detail
 * endpoint surfaces at most one active attempt at a time so the UI can render
 * a clear "an agent is working on this" signal. A unique partial index on
 * `bug_fix_attempts` (`bug_fix_attempts_cluster_active_unique_idx`) guarantees
 * only one cluster-scoped attempt with these statuses exists at any time.
 */
const ACTIVE_BUG_FIX_ATTEMPT_STATUSES: ReadonlyArray<BugFixAttemptWithPr["status"]> = [
  "analyzing",
  "proposed",
  "implementing",
];

/**
 * Resolved author for a cluster-detail feedback item.
 *
 * Built by LEFT JOINing `feedback_items.authorEmail` against `user.email`.
 * When a user matches, the repository fills in `userId`, `name`, and
 * `avatarUrl` from the user row; otherwise the fields fall back to the
 * feedback item's own author columns. `isAnonymous` is true only when the
 * feedback item has no author email AND no matching user — in that case the
 * UI should render an identicon. When an email exists but no user row
 * matches, the UI can derive a Gravatar from the email.
 */
export interface FeedbackClusterDetailItemAuthor {
  userId: string | null;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  isAnonymous: boolean;
}

/**
 * Enriched item shape returned by `getFeedbackClusterDetail`. Mirrors the
 * frontend `ClusterTicketItem` interface so the cluster-detail mapper can
 * pass the payload through with minimal shape gymnastics.
 *
 * - `metadata`: typed union of widget payloads (bug debug context vs simple
 *   metadata) or `null` when the item was ingested without widget metadata.
 *   Best-effort narrowing based on the presence of `userAgent` /`source`
 *   keys — a consumer that needs strict validation should re-check.
 * - `debugBundleId`: lifted from `metadata.debugBundleId` so the UI can
 *   deep-link to an incident bundle without reparsing the metadata blob.
 * - `ticketNumber`: reserved for a future human-readable ticket reference;
 *   always `null` today (no column yet).
 * - `author`: resolved via LEFT JOIN with `user` on email; see
 *   `FeedbackClusterDetailItemAuthor` for the field semantics.
 */
export interface FeedbackClusterDetailItem {
  id: string;
  title: string;
  content: string | null;
  authorName: string | null;
  status: string;
  aiCategory: string | null;
  createdAt: Date;
  metadata: DebugContext | FeedbackWidgetSimpleMetadata | null;
  debugBundleId: string | null;
  ticketNumber: string | null;
  author: FeedbackClusterDetailItemAuthor;
}

/**
 * Shape returned by `getFeedbackClusterDetail`. Wraps everything the cluster
 * detail modal needs behind a single repository call so the frontend avoids
 * a 4-fetch waterfall.
 *
 * - `cluster`: the cluster row itself.
 * - `items`: all feedback items linked to the cluster, ordered by `createdAt` DESC,
 *   enriched with resolved author info and widget metadata.
 * - `bugFixAttempts`: all cluster-scoped bug fix attempts with PR enrichment,
 *   ordered by `attemptNumber` DESC then `createdAt` DESC.
 * - `activeAttempt`: the single in-flight attempt (if any) derived in code
 *   from `bugFixAttempts`. Saves the frontend from replicating the status set.
 * - `statusHistory`: full status transition history ordered by `changedAt` ASC
 *   so the UI can render a chronological timeline.
 * - `promotion`: the most recent promotion (if the cluster was ever promoted),
 *   along with the joined work item (null when the work item was deleted).
 * - `timelineEvents`: chronologically-sorted flat list of cluster events
 *   (`ticket_created`, `status_transition`, `attempt_launched`, `pr_opened`,
 *   `pr_merged`, `regression_detected`). Derived in-memory from `items`,
 *   `bugFixAttempts`, and `statusHistory` via `buildClusterTimeline` (A-F-434).
 * - `summary` (A-1876): explicit UX-oriented snapshot of lifecycle phase,
 *   active attempt, incident context (first incident vs regression), and the
 *   last meaningful change. Derived in-memory from `cluster`, `activeAttempt`,
 *   and `statusHistory` via `buildClusterSummary`. The frontend consumes this
 *   directly so it no longer has to re-derive state from multiple raw fields.
 */
export interface FeedbackClusterDetail {
  cluster: FeedbackCluster;
  items: FeedbackClusterDetailItem[];
  bugFixAttempts: BugFixAttemptWithPr[];
  activeAttempt: BugFixAttemptWithPr | null;
  statusHistory: ClusterStatusHistory[];
  promotion: { promotion: FeedbackPromotion; workItem: WorkItemDb | null } | null;
  timelineEvents: ClusterTimelineEvent[];
  summary: ClusterSummary;
}

/**
 * Aggregate fetch for the cluster detail modal.
 *
 * Fetches the cluster first (fail-fast with `null` if it doesn't exist), then
 * runs the 4 related queries in parallel:
 *   1. feedback items linked to the cluster
 *   2. bug fix attempts (joined with github_pull_requests)
 *   3. most recent promotion + joined work item
 *   4. cluster status history
 *
 * `activeAttempt` is derived in memory from `bugFixAttempts` to avoid a 5th
 * query — the list is already in memory and typically small (<10 rows).
 */
/**
 * Narrow a raw metadata jsonb blob into the typed union the detail shape
 * exposes. We distinguish three cases:
 *   - `DebugContext`: widget-submitted bug with full browser/OS info. Detected
 *     by `source === "widget"` AND the presence of `userAgent` — the latter
 *     is the simplest marker that separates bug contexts from the lean
 *     "simple" metadata shape.
 *   - `FeedbackWidgetSimpleMetadata`: widget-submitted non-bug with only the
 *     minimal pageUrl/locale/source triad.
 *   - `null`: anything else (API ingest, Telegram, manual, empty jsonb).
 *
 * Anything that doesn't match either widget shape falls back to `null` so
 * downstream consumers can rely on the typed union without extra guards.
 */
const narrowFeedbackMetadata = (
  raw: Record<string, unknown> | null | undefined
): DebugContext | FeedbackWidgetSimpleMetadata | null => {
  if (!raw || typeof raw !== "object") return null;
  if (raw.source !== "widget") return null;

  if (typeof raw.userAgent === "string") {
    return raw as unknown as DebugContext;
  }

  if (typeof raw.pageUrl === "string" && typeof raw.locale === "string") {
    return raw as unknown as FeedbackWidgetSimpleMetadata;
  }

  return null;
};

export const getFeedbackClusterDetail = async (
  id: string
): Promise<FeedbackClusterDetail | null> => {
  // 1. Fail-fast if the cluster does not exist so we don't waste 4 queries.
  const cluster = await getFeedbackClusterById(id);
  if (!cluster) return null;

  // 2. Fan out the non-attempt queries in parallel. The items query LEFT JOINs
  //    the `user` table by email so the author can be resolved in one pass:
  //    matching users contribute the stable userId + image (avatar); rows
  //    without a match still return the feedback_item's own authorName/Email.
  //    `user.email` is UNIQUE, so the LEFT JOIN never duplicates rows.
  //
  //    A-1910: attempts loading is deferred to stage 3 because it now needs
  //    the resolved `itemRows.id` list to include legacy attempts (rows with
  //    `cluster_id` NULL but `feedback_item_id` set) via a single UNION-like
  //    OR filter. Pulling attempts alongside items would have required either
  //    a second query round-trip here or a correlated subquery; the explicit
  //    two-stage shape is simpler and keeps the repository readable.
  const [itemRows, promotion, statusHistory] = await Promise.all([
    db
      .select({
        id: feedbackItems.id,
        title: feedbackItems.title,
        content: feedbackItems.content,
        authorName: feedbackItems.authorName,
        authorEmail: feedbackItems.authorEmail,
        status: feedbackItems.status,
        aiCategory: feedbackItems.aiCategory,
        createdAt: feedbackItems.createdAt,
        metadata: feedbackItems.metadata,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userImage: user.image,
      })
      .from(feedbackItems)
      .leftJoin(user, eq(user.email, feedbackItems.authorEmail))
      .where(eq(feedbackItems.clusterId, id))
      .orderBy(desc(feedbackItems.createdAt)),
    findFirstPromotionForClusterWithWorkItem(id),
    db
      .select()
      .from(clusterStatusHistory)
      .where(eq(clusterStatusHistory.clusterId, id))
      .orderBy(asc(clusterStatusHistory.changedAt)),
  ]);

  // 2b. A-1910: widen the attempts load to cover both cluster-scoped and
  //     legacy item-scoped rows. Legacy attempts predate the cluster_id
  //     column being populated — their `cluster_id` is NULL but their
  //     `feedback_item_id` now resolves to an item inside this cluster, so
  //     the PR they produced must still surface in the cluster modal.
  //
  //     A single `bug_fix_attempts` row with BOTH cluster_id and
  //     feedback_item_id set is matched exactly once by the OR filter, so
  //     there is no duplication at the SQL layer; the helper still dedupes
  //     by `attempt.id` defensively.
  const itemIds = itemRows.map((row) => row.id);
  const bugFixAttempts = await listBugFixAttemptsWithPrByClusterOrItems(
    id,
    itemIds
  );

  // 3. Map each joined row into the enriched item shape. Metadata is narrowed
  //    into its typed union, debugBundleId is lifted for easy access, and the
  //    author fields fall back from user → feedback_item authorName/Email.
  const items: FeedbackClusterDetailItem[] = itemRows.map((row) => {
    const metadata = narrowFeedbackMetadata(row.metadata);
    const rawMeta = row.metadata as Record<string, unknown> | null | undefined;
    const rawDebugBundleId = rawMeta?.debugBundleId;
    const debugBundleId =
      typeof rawDebugBundleId === "string" ? rawDebugBundleId : null;

    const resolvedEmail = row.userEmail ?? row.authorEmail ?? null;
    const author: FeedbackClusterDetailItemAuthor = {
      userId: row.userId ?? null,
      name: row.userName ?? row.authorName ?? null,
      email: resolvedEmail,
      avatarUrl: row.userImage ?? null,
      isAnonymous: !row.authorEmail && !row.userId,
    };

    return {
      id: row.id,
      title: row.title,
      content: row.content,
      authorName: row.authorName,
      status: row.status,
      aiCategory: row.aiCategory,
      createdAt: row.createdAt,
      metadata,
      debugBundleId,
      ticketNumber: null,
      author,
    };
  });

  // 4. Derive the active attempt (if any). The schema's partial unique index
  //    ensures at most one matches, but we keep the `.find` semantics so the
  //    UI degrades gracefully if an invariant is ever violated.
  const activeAttempt =
    bugFixAttempts.find((attempt) =>
      ACTIVE_BUG_FIX_ATTEMPT_STATUSES.includes(attempt.status)
    ) ?? null;

  // 5. Derive the timeline in-memory from the three arrays already loaded.
  //    Pure, zero-I/O, so it doesn't add a query to the detail fetch. The
  //    builder lives in `src/lib` (A-F-434) precisely so the repository can
  //    call it without a reverse dependency from database → api.
  const timelineEvents = buildClusterTimeline({
    items,
    attempts: bugFixAttempts,
    statusHistory,
  });

  // 6. Derive the explicit UX summary (A-1876). Same rules as the timeline:
  //    pure, no extra queries, and kept alongside the raw arrays for
  //    backwards compatibility — consumers that still rely on the legacy
  //    fields keep working.
  const summary = buildClusterSummary({
    cluster,
    activeAttempt,
    statusHistory,
  });

  return {
    cluster,
    items,
    bugFixAttempts,
    activeAttempt,
    statusHistory,
    promotion,
    timelineEvents,
    summary,
  };
};

/**
 * Reassign multiple clusters to a new topic (or remove their topic assignment).
 *
 * Returns the number of clusters updated.
 */
export const reassignClustersToTopic = async (
  clusterIds: string[],
  newTopicId: string | null
): Promise<number> => {
  if (clusterIds.length === 0) return 0;

  const result = await db
    .update(feedbackClusters)
    .set({ topicId: newTopicId, updatedAt: new Date() })
    .where(inArray(feedbackClusters.id, clusterIds))
    .returning({ id: feedbackClusters.id });

  return result.length;
};

// --- Cluster status transitions ---
//
// Centralised state-machine for feedback_clusters. Every status change MUST
// go through `transitionCluster` so that:
//   1. Invalid transitions are rejected consistently across callers (hooks,
//      agents, webhooks, manual user actions).
//   2. Derived fields (`resolvedAt`, `resolvedByAttemptId`, `lastRegressionAt`,
//      `regressionCount`) stay in sync with `status`.
//   3. Every change appends a row to `cluster_status_history` for MTTR and
//      toxic-cluster analytics.
//
// The matrix is intentionally co-located with the helper so the contract is
// discoverable from a single file. If you add a new status to the enum, you
// MUST also add its row to `CLUSTER_TRANSITIONS` — the Record type forces this.

/**
 * Union of valid feedback_cluster status values, derived from the Drizzle enum
 * definition so the TypeScript type stays in sync with the database column.
 */
export type ClusterStatusEnum =
  typeof feedbackClusterStatusEnum.enumValues[number];

/**
 * Allowed status transitions for a feedback cluster.
 *
 * - `dismissed` and `promoted` are terminal. `promoted` is a legacy value
 *   retained for rows created before the new lifecycle (see enums.ts); no new
 *   transitions TO or FROM it are permitted via this helper.
 * - `resolved` → `regression` captures the case where a previously-resolved
 *   cluster receives a new matching report; it bumps `regression_count`.
 * - `resolved` → `investigating` is the "manual reopen" path used when a human
 *   decides the resolution was wrong but no fresh feedback has arrived.
 */
export const CLUSTER_TRANSITIONS: Record<
  ClusterStatusEnum,
  ClusterStatusEnum[]
> = {
  open: ["investigating", "dismissed"],
  investigating: ["fix_ready", "open", "dismissed"],
  fix_ready: ["resolved", "open", "dismissed"],
  resolved: ["regression", "investigating", "dismissed"],
  regression: ["investigating", "dismissed"],
  dismissed: [],
  promoted: [],
};

/**
 * Pure predicate over `CLUSTER_TRANSITIONS`. Exported so unit tests and UI
 * layers can validate transitions without hitting the database.
 */
export const isValidTransition = (
  from: ClusterStatusEnum,
  to: ClusterStatusEnum
): boolean => {
  const allowed = CLUSTER_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
};

/**
 * Who / what triggered a status transition. Persisted to
 * `cluster_status_history` for audit and analytics.
 *
 * `triggeredByKind` is a free-form string in the DB (varchar 20) to allow new
 * actor kinds without a migration, but this repository narrows it to the
 * known set so callers get compile-time safety.
 */
export type ClusterTransitionKind = "user" | "system" | "agent" | "webhook";

export interface ClusterTransitionEvent {
  triggeredByKind: ClusterTransitionKind;
  triggeredByUserId?: string | null;
  triggeredByAttemptId?: string | null;
  triggeredByAgentJobId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export type TransitionResult =
  | {
      success: true;
      from: ClusterStatusEnum;
      to: ClusterStatusEnum;
      cluster: FeedbackCluster;
    }
  | { success: false; reason: "cluster_not_found" }
  | {
      success: false;
      reason: "invalid_transition";
      from: ClusterStatusEnum;
      to: ClusterStatusEnum;
      allowed: ClusterStatusEnum[];
    };

/**
 * Apply a status transition to a feedback cluster inside a single transaction.
 *
 * Steps:
 *  1. SELECT ... FOR UPDATE the target cluster to serialise concurrent hooks
 *     (e.g. webhook + agent both reacting to the same PR merge).
 *  2. Return `cluster_not_found` if the row does not exist.
 *  3. No-op success when `toStatus === cluster.status` — this keeps callers
 *     idempotent; they can retry safely without tripping the matrix check.
 *  4. Reject with `invalid_transition` if the matrix disallows the move.
 *  5. UPDATE the cluster: always bump `updatedAt`, and additionally:
 *       - `toStatus === "resolved"` → set `resolvedAt = now()` and, if the
 *         event carries a `triggeredByAttemptId`, link the resolving attempt.
 *       - `toStatus === "regression"` → stamp `lastRegressionAt = now()` and
 *         increment `regressionCount` via `regressionCount + 1` (SQL-side to
 *         remain safe under concurrency).
 *  6. INSERT a `cluster_status_history` row recording `from`, `to`, actor
 *     fields, optional reason and free-form metadata. `changedAt` uses the
 *     column default.
 */
export const transitionCluster = async (
  clusterId: string,
  toStatus: ClusterStatusEnum,
  event: ClusterTransitionEvent
): Promise<TransitionResult> => {
  return db.transaction(async (tx) => {
    // 1. Lock the cluster row for the duration of the tx
    const [cluster] = await tx
      .select()
      .from(feedbackClusters)
      .where(eq(feedbackClusters.id, clusterId))
      .for("update")
      .limit(1);

    if (!cluster) {
      return { success: false, reason: "cluster_not_found" as const };
    }

    const fromStatus = cluster.status;

    // 3. Idempotent no-op: same status → return success without writing
    if (toStatus === fromStatus) {
      return {
        success: true as const,
        from: fromStatus,
        to: toStatus,
        cluster,
      };
    }

    // 4. Validate against the matrix
    if (!isValidTransition(fromStatus, toStatus)) {
      return {
        success: false as const,
        reason: "invalid_transition" as const,
        from: fromStatus,
        to: toStatus,
        allowed: CLUSTER_TRANSITIONS[fromStatus] ?? [],
      };
    }

    // 5. Build the UPDATE set clause, layering destination-specific fields on
    //    top of the always-applied `status` + `updatedAt` pair.
    const now = new Date();
    const updateValues: Record<string, unknown> = {
      status: toStatus,
      updatedAt: now,
    };

    if (toStatus === "resolved") {
      updateValues.resolvedAt = now;
      if (event.triggeredByAttemptId) {
        updateValues.resolvedByAttemptId = event.triggeredByAttemptId;
      }
    } else if (toStatus === "regression") {
      updateValues.lastRegressionAt = now;
      updateValues.regressionCount = sql`${feedbackClusters.regressionCount} + 1`;
    }

    const [updatedCluster] = await tx
      .update(feedbackClusters)
      .set(updateValues)
      .where(eq(feedbackClusters.id, clusterId))
      .returning();

    if (!updatedCluster) {
      // Should be impossible given the FOR UPDATE lock above, but keep the
      // type-safety guard so we fail loudly instead of returning a partial
      // success.
      throw new Error(
        `transitionCluster: UPDATE returned no rows for cluster ${clusterId}`
      );
    }

    // 6. Append audit row. `changedAt` uses the column default (now()).
    await tx.insert(clusterStatusHistory).values({
      clusterId,
      fromStatus,
      toStatus,
      triggeredByKind: event.triggeredByKind,
      triggeredByUserId: event.triggeredByUserId ?? null,
      triggeredByAttemptId: event.triggeredByAttemptId ?? null,
      triggeredByAgentJobId: event.triggeredByAgentJobId ?? null,
      reason: event.reason ?? null,
      metadata: event.metadata ?? {},
    });

    return {
      success: true as const,
      from: fromStatus,
      to: toStatus,
      cluster: updatedCluster,
    };
  });
};

// --- Dismiss cluster with reason + cascade to feedback items ---
//
// A-1911: atomic user-driven dismissal. Unlike `transitionCluster`, this
// helper (a) persists the free-text reason, (b) cascades to `feedback_items`
// by setting any non-terminal linked item to `cancelled`, and (c) is
// idempotent when the cluster is already `dismissed` — a second call is a
// no-op that returns `dismissedItemCount: 0` instead of `invalid_transition`.

/**
 * Statuses considered terminal for the feedback-item cascade. Items already in
 * these states are left untouched by `dismissClusterWithReason`.
 *
 * `cancelled` — matches the target state; a no-op update.
 * `verified`  — human-confirmed as fixed; dismissing the cluster must not
 *               rewrite history.
 * `deployed`  — fix is live; same reasoning as `verified`.
 */
export const DISMISS_CLUSTER_TERMINAL_ITEM_STATUSES = [
  "cancelled",
  "verified",
  "deployed",
] as const;

export interface DismissClusterWithReasonInput {
  clusterId: string;
  userId: string;
  /** Optional free-text reason persisted to `cluster_status_history.reason`. */
  reason?: string;
  /**
   * Current active workspace — not persisted on the cluster but forwarded
   * to future audit fields if needed. Today it's used only for logs.
   */
  workspaceId: string;
}

export type DismissClusterWithReasonResult =
  | {
      success: true;
      cluster: FeedbackCluster;
      dismissedItemCount: number;
      /** True when the cluster was already `dismissed` before the call. */
      alreadyDismissed: boolean;
    }
  | { success: false; reason: "cluster_not_found" }
  | {
      success: false;
      reason: "invalid_state";
      currentStatus: ClusterStatusEnum;
      allowedStatuses: ClusterStatusEnum[];
    };

/**
 * Transactionally dismiss a cluster with a user-supplied reason, cascading to
 * its non-terminal feedback items.
 *
 * Steps (all inside a single tx + `FOR UPDATE` cluster lock):
 *   1. Lock the cluster row. Return `cluster_not_found` when absent.
 *   2. If already `dismissed`: no-op → `{ success: true, alreadyDismissed: true }`.
 *   3. Validate the current status can transition to `dismissed` via
 *      `CLUSTER_TRANSITIONS`. Reject with `invalid_state` otherwise.
 *   4. UPDATE `feedback_clusters.status = 'dismissed'` + `updatedAt`.
 *   5. INSERT into `cluster_status_history` (reason is stored here — no new
 *      column is introduced).
 *   6. UPDATE `feedback_items` whose `cluster_id` matches AND whose status is
 *      NOT terminal (`cancelled`, `verified`, `deployed`) → `'cancelled'`.
 *      Returns the count of rows actually touched for the response body.
 */
export const dismissClusterWithReason = async (
  input: DismissClusterWithReasonInput
): Promise<DismissClusterWithReasonResult> => {
  const { clusterId, userId, reason } = input;

  return db.transaction(async (tx) => {
    // 1. Lock the cluster row
    const [cluster] = await tx
      .select()
      .from(feedbackClusters)
      .where(eq(feedbackClusters.id, clusterId))
      .for("update")
      .limit(1);

    if (!cluster) {
      return { success: false as const, reason: "cluster_not_found" as const };
    }

    const fromStatus = cluster.status;

    // 2. Idempotent no-op when the cluster is already dismissed
    if (fromStatus === "dismissed") {
      return {
        success: true as const,
        cluster,
        dismissedItemCount: 0,
        alreadyDismissed: true,
      };
    }

    // 3. Matrix check. `dismissed` must be reachable from the current status.
    if (!isValidTransition(fromStatus, "dismissed")) {
      return {
        success: false as const,
        reason: "invalid_state" as const,
        currentStatus: fromStatus,
        allowedStatuses: CLUSTER_TRANSITIONS[fromStatus] ?? [],
      };
    }

    // 4. Flip the cluster status
    const now = new Date();
    const [updatedCluster] = await tx
      .update(feedbackClusters)
      .set({ status: "dismissed", updatedAt: now })
      .where(eq(feedbackClusters.id, clusterId))
      .returning();

    if (!updatedCluster) {
      throw new Error(
        `dismissClusterWithReason: UPDATE returned no rows for cluster ${clusterId}`
      );
    }

    // 5. Append audit row. Reason is persisted here so no new column is
    //    required on `feedback_clusters` itself.
    await tx.insert(clusterStatusHistory).values({
      clusterId,
      fromStatus,
      toStatus: "dismissed",
      triggeredByKind: "user",
      triggeredByUserId: userId,
      triggeredByAttemptId: null,
      triggeredByAgentJobId: null,
      reason: reason ?? null,
      metadata: {},
    });

    // 6. Cascade to non-terminal feedback items. `deployed` and `verified`
    //    represent stable, human-confirmed outcomes; leaving them alone keeps
    //    analytics/history truthful when an ops user dismisses a noisy cluster.
    const updatedItems = await tx
      .update(feedbackItems)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(feedbackItems.clusterId, clusterId),
          sql`${feedbackItems.status} NOT IN ('cancelled', 'verified', 'deployed')`
        )
      )
      .returning({ id: feedbackItems.id });

    return {
      success: true as const,
      cluster: updatedCluster,
      dismissedItemCount: updatedItems.length,
      alreadyDismissed: false,
    };
  });
};

// --- Cluster investigation launch ---

/**
 * Canonical retry budget cap (A-F-435 / A-F-389).
 *
 * Maximum number of bug fix attempts permitted PER CLUSTER when the attempt
 * is cluster-scoped (the common case). When no cluster is associated with the
 * attempt, the budget falls back to a per-feedback-item count. Either way the
 * cap is the same constant so the UX contract ("3 attempts then stop") is
 * uniform across the codebase.
 *
 * This constant is the single source of truth — both
 * `launchClusterInvestigation` in this file and `createBugFixAttemptFromClaim`
 * in `bug-fix-attempt-repository.ts` compute their budget via
 * `computeClusterRetryBudget` so the rule cannot drift between call sites.
 */
export const CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS = 3;

/**
 * Backwards-compatible alias for the old internal constant name. Kept so any
 * caller or test that imported the previous symbol continues to compile while
 * new code migrates to `CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS`.
 */
export const LAUNCH_INVESTIGATION_MAX_ATTEMPTS = CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS;

/**
 * Which entity the retry budget is counted against. When a cluster is
 * available we always prefer the cluster anchor; only when no cluster is
 * linked do we fall back to counting attempts on the feedback item itself.
 */
export type RetryBudgetAnchor = "cluster" | "feedback_item";

/**
 * Snapshot of the retry budget for a given anchor.
 *
 * - `anchor`: whether the count was taken against the cluster or the feedback
 *   item. Call sites surface this in error responses so the UI can render a
 *   precise message ("this cluster already has 3 attempts").
 * - `anchorId`: the id of the cluster or feedback item the count belongs to.
 * - `currentCount`: total number of `bug_fix_attempts` rows for the anchor
 *   across all statuses. Failed/cancelled attempts count against the budget
 *   so an unbounded retry loop is impossible.
 * - `maxAttempts`: the cap applied — always `CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS`.
 * - `isExhausted`: convenience predicate (`currentCount >= maxAttempts`).
 */
export interface RetryBudgetStatus {
  anchor: RetryBudgetAnchor;
  anchorId: string;
  currentCount: number;
  maxAttempts: number;
  isExhausted: boolean;
}

/**
 * Minimal shape of a Drizzle executor: either the top-level `db` instance or
 * a transaction handle `tx` passed to `db.transaction(async (tx) => …)`. Both
 * expose the same `select` surface used by `computeClusterRetryBudget`.
 */
type AnyDrizzleExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Compute the canonical retry budget for a bug-fix attempt.
 *
 * Rule (A-F-435 / A-F-389):
 *   - If `clusterId` is non-null → count attempts `WHERE cluster_id = clusterId`.
 *   - Else if `feedbackItemId` is non-null → count attempts
 *     `WHERE feedback_item_id = feedbackItemId`.
 *   - Else → throw (invariant: at least one anchor must be provided).
 *
 * Counts include ALL statuses (analyzing, proposed, implementing, merged,
 * failed, reverted, etc.) — the budget is about effort spent, not successes.
 *
 * Accepts either the top-level `db` or a transaction handle so callers can
 * compute the budget inside an outer transaction that also performs the
 * INSERT; this avoids a lost-update race where two concurrent launches each
 * see `currentCount = 2` and both INSERT.
 */
export const computeClusterRetryBudget = async (
  executor: AnyDrizzleExecutor,
  args: { clusterId: string | null; feedbackItemId: string | null }
): Promise<RetryBudgetStatus> => {
  if (args.clusterId) {
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(bugFixAttempts)
      .where(eq(bugFixAttempts.clusterId, args.clusterId));

    const currentCount = row?.count ?? 0;
    return {
      anchor: "cluster",
      anchorId: args.clusterId,
      currentCount,
      maxAttempts: CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS,
      isExhausted: currentCount >= CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS,
    };
  }

  if (args.feedbackItemId) {
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(bugFixAttempts)
      .where(eq(bugFixAttempts.feedbackItemId, args.feedbackItemId));

    const currentCount = row?.count ?? 0;
    return {
      anchor: "feedback_item",
      anchorId: args.feedbackItemId,
      currentCount,
      maxAttempts: CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS,
      isExhausted: currentCount >= CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS,
    };
  }

  throw new Error(
    "computeClusterRetryBudget: at least one of { clusterId, feedbackItemId } must be provided"
  );
};

/**
 * Cluster statuses from which launching an investigation is permitted.
 *
 * - `open`: the happy path — a newly triaged cluster with no fix in flight.
 * - `resolved`: a previously resolved cluster where we want to reopen for
 *   deeper investigation without waiting for fresh regression signals.
 * - `regression`: a cluster that flipped back after resolution and needs a
 *   new attempt. `transitionCluster` allows `regression → investigating`.
 */
const LAUNCH_INVESTIGATION_ALLOWED_STATUSES = [
  "open",
  "resolved",
  "regression",
] as const satisfies ReadonlyArray<ClusterStatusEnum>;

/**
 * Active bug-fix statuses. A cluster may have at most one attempt in any of
 * these states at a time — enforced by the partial unique index
 * `bug_fix_attempts_cluster_active_unique_idx`.
 */
const LAUNCH_INVESTIGATION_ACTIVE_ATTEMPT_STATUSES = [
  "analyzing",
  "proposed",
  "implementing",
] as const;

/**
 * Partial unique index name used to detect race-condition duplicates on
 * INSERT. We translate the 23505 violation into the `active_attempt_exists`
 * reason so callers can fall through to the existing attempt.
 */
const BUG_FIX_ATTEMPTS_CLUSTER_ACTIVE_UNIQUE_INDEX =
  "bug_fix_attempts_cluster_active_unique_idx";

/**
 * Partial unique index enforcing `(cluster_id, attempt_number)` uniqueness for
 * cluster-scoped attempts. A 23505 on this index is a benign race: two
 * concurrent launches both computed the same `budget.currentCount` and both
 * tried to INSERT with `attempt_number = currentCount + 1`. One wins, the
 * other must retry with a recomputed number (or fall through to
 * `active_attempt_exists` if the winner left an active row).
 */
const BUG_FIX_ATTEMPTS_CLUSTER_ATTEMPT_NUMBER_UNIQUE_INDEX =
  "bug_fix_attempts_cluster_attempt_number_unique_idx";

/**
 * Input for `launchClusterInvestigation`.
 *
 * The core contract specified by A-1823 is `{ clusterId, userId, domain? }`.
 * `projectId` and `workspaceId` are additionally required because the
 * `bug_fix_attempts` table enforces NOT NULL FKs to both — the caller (the
 * HTTP route in A-1827) is responsible for resolving them from the session
 * context before invoking the repository.
 */
export interface LaunchInvestigationRequest {
  clusterId: string;
  userId: string;
  projectId: string;
  workspaceId: string;
  domain?: "frontend" | "backend" | "coding-agent" | "infrastructure" | "unknown";
}

/**
 * Tagged union result for `launchClusterInvestigation`. Every failure reason
 * is explicit so HTTP routes can map them to stable status codes (409 vs 422
 * vs 404) without inspecting error messages.
 */
export type LaunchInvestigationResult =
  | {
      success: true;
      attempt: BugFixAttempt;
      cluster: FeedbackCluster;
      primaryFeedbackItemId: string;
    }
  | { success: false; reason: "cluster_not_found" }
  | { success: false; reason: "invalid_state"; currentStatus: string }
  | { success: false; reason: "active_attempt_exists"; activeAttemptId?: string }
  | { success: false; reason: "cluster_empty" }
  | {
      success: false;
      reason: "max_attempts_reached";
      budget: RetryBudgetStatus;
    };

/**
 * Narrowed shape of a pg unique-violation error. We only care about two
 * fields: the SQLSTATE code (`23505`) and the constraint name so we can tell
 * which unique index was violated.
 */
interface PgUniqueViolationError {
  code?: string;
  constraint_name?: string;
  cause?: unknown;
}

/**
 * Which cluster-scoped partial unique index raised the 23505, if any.
 *
 * - `active`: `bug_fix_attempts_cluster_active_unique_idx` — another tx
 *   already has an attempt in {analyzing, proposed, implementing} for this
 *   cluster. Fall through to `active_attempt_exists`.
 * - `attempt_number`: `bug_fix_attempts_cluster_attempt_number_unique_idx` —
 *   both transactions computed the same `currentCount` and collided on
 *   `(cluster_id, attempt_number)`. Benign race, safe to retry once with a
 *   recomputed attempt number.
 * - `null`: not a unique-violation we know how to handle — rethrow.
 */
type BugFixAttemptUniqueViolationKind = "active" | "attempt_number";

/**
 * Classify a thrown error as one of the cluster-scoped unique-index
 * violations on `bug_fix_attempts`. Drizzle wraps driver errors in some
 * versions, so we walk `err.cause` one level to find the underlying pg
 * `{ code, constraint_name }` pair.
 */
const getBugFixAttemptUniqueViolationKind = (
  err: unknown
): BugFixAttemptUniqueViolationKind | null => {
  if (!err || typeof err !== "object") return null;

  const probe = (candidate: unknown): BugFixAttemptUniqueViolationKind | null => {
    if (!candidate || typeof candidate !== "object") return null;
    const pg = candidate as PgUniqueViolationError;
    if (pg.code !== "23505") return null;
    if (pg.constraint_name === BUG_FIX_ATTEMPTS_CLUSTER_ACTIVE_UNIQUE_INDEX) {
      return "active";
    }
    if (
      pg.constraint_name ===
      BUG_FIX_ATTEMPTS_CLUSTER_ATTEMPT_NUMBER_UNIQUE_INDEX
    ) {
      return "attempt_number";
    }
    return null;
  };

  // Direct match (postgres-js typically throws the raw error).
  const direct = probe(err);
  if (direct) return direct;

  // One level of unwrap for Drizzle/ORM-wrapped errors.
  const wrapped = (err as PgUniqueViolationError).cause;
  return probe(wrapped);
};

/**
 * Launch a new investigation on a cluster in a single atomic transaction.
 *
 * This is the transactional core of the "launch investigation" flow. It is
 * responsible for three mutations that MUST succeed or fail together:
 *   1. INSERT a fresh `bug_fix_attempts` row scoped to the cluster (the oldest
 *      feedback item is used only to satisfy the NOT NULL FK; the retry budget
 *      and attempt numbering are counted PER CLUSTER — see A-F-435 / A-F-389).
 *   2. Transition the cluster to `investigating` via the same state-machine
 *      rules that `transitionCluster` enforces (inline here to share the tx).
 *   3. Append a `cluster_status_history` row for audit.
 *
 * NOTE: Enqueueing the agent job is NOT this function's responsibility; the
 * HTTP route (A-1827) does that AFTER this function returns `success: true`.
 *
 * Idempotency is guaranteed by the partial unique index
 * `bug_fix_attempts_cluster_active_unique_idx` — two concurrent launches for
 * the same cluster will serialise on the SELECT FOR UPDATE, but if somehow
 * they both try to INSERT, the second INSERT hits a 23505 and we translate
 * it into `{ success: false, reason: 'active_attempt_exists' }`.
 *
 * Failure reasons (in the order they are checked):
 *   - `cluster_not_found`: cluster row does not exist.
 *   - `invalid_state`: cluster status is not one of open/resolved/regression.
 *   - `active_attempt_exists`: an analyzing/proposed/implementing attempt
 *     already exists for this cluster (found pre-INSERT or via unique index).
 *   - `cluster_empty`: no feedback_items link to the cluster — we cannot
 *     pick a primary item and therefore cannot number the attempt.
 *   - `max_attempts_reached`: the retry budget has been exhausted. The
 *     budget is counted PER CLUSTER (A-F-435 / A-F-389) — any cluster that
 *     already has 3 bug_fix_attempts (across all statuses) is frozen out
 *     of further investigations.
 */
export const launchClusterInvestigation = async (
  req: LaunchInvestigationRequest
): Promise<LaunchInvestigationResult> => {
  const { clusterId, userId, projectId, workspaceId, domain } = req;

  return db.transaction(async (tx) => {
    // 1. Lock the cluster row so concurrent launches serialise on this tx.
    const [cluster] = await tx
      .select()
      .from(feedbackClusters)
      .where(eq(feedbackClusters.id, clusterId))
      .for("update")
      .limit(1);

    if (!cluster) {
      return { success: false as const, reason: "cluster_not_found" as const };
    }

    // 2. Validate the cluster is in a launchable state.
    if (
      !LAUNCH_INVESTIGATION_ALLOWED_STATUSES.includes(
        cluster.status as (typeof LAUNCH_INVESTIGATION_ALLOWED_STATUSES)[number]
      )
    ) {
      return {
        success: false as const,
        reason: "invalid_state" as const,
        currentStatus: cluster.status,
      };
    }

    // 3. Fast-path idempotency: look for an existing active attempt before
    //    we try to INSERT. This avoids relying solely on the unique index
    //    violation path for the common case (sequential retries).
    const [existingActive] = await tx
      .select({ id: bugFixAttempts.id })
      .from(bugFixAttempts)
      .where(
        and(
          eq(bugFixAttempts.clusterId, clusterId),
          inArray(
            bugFixAttempts.status,
            LAUNCH_INVESTIGATION_ACTIVE_ATTEMPT_STATUSES as unknown as Array<
              BugFixAttempt["status"]
            >
          )
        )
      )
      .limit(1);

    if (existingActive) {
      return {
        success: false as const,
        reason: "active_attempt_exists" as const,
        activeAttemptId: existingActive.id,
      };
    }

    // 4. Pick the primary feedback item (oldest-in-cluster). This is only
    //    needed to satisfy the NOT NULL feedback_item_id FK on the
    //    bug_fix_attempts row — the retry budget itself is counted PER
    //    CLUSTER (A-F-435 / A-F-389), not per feedback item.
    const [primary] = await tx
      .select({ id: feedbackItems.id, createdAt: feedbackItems.createdAt })
      .from(feedbackItems)
      .where(eq(feedbackItems.clusterId, clusterId))
      .orderBy(asc(feedbackItems.createdAt))
      .limit(1);

    if (!primary) {
      return { success: false as const, reason: "cluster_empty" as const };
    }

    // 5. Enforce the canonical retry budget. When a clusterId is present,
    //    the budget is counted across ALL bug_fix_attempts for the cluster
    //    (any status) — so an unbounded retry loop is impossible even if
    //    every attempt fails. Falls back to per-feedback-item counting only
    //    when `clusterId` is null, which does not apply here.
    const budget = await computeClusterRetryBudget(tx, {
      clusterId,
      feedbackItemId: null,
    });
    if (budget.isExhausted) {
      return {
        success: false as const,
        reason: "max_attempts_reached" as const,
        budget,
      };
    }

    // 6. INSERT the attempt. Two partial unique indexes on `bug_fix_attempts`
    //    can raise a 23505 here when two launches race for the same cluster:
    //      - `…_cluster_active_unique_idx`  -> the other tx already has an
    //        active attempt; translate to `active_attempt_exists`.
    //      - `…_cluster_attempt_number_unique_idx` -> both txs picked the
    //        same `attempt_number`. Benign: recompute the budget and retry
    //        the INSERT once. If the winner then reveals itself as active,
    //        fall through to `active_attempt_exists` so callers can attach
    //        to it instead of erroring.
    const lookupActiveWinner = async (): Promise<string | undefined> => {
      const [winner] = await tx
        .select({ id: bugFixAttempts.id })
        .from(bugFixAttempts)
        .where(
          and(
            eq(bugFixAttempts.clusterId, clusterId),
            inArray(
              bugFixAttempts.status,
              LAUNCH_INVESTIGATION_ACTIVE_ATTEMPT_STATUSES as unknown as Array<
                BugFixAttempt["status"]
              >
            )
          )
        )
        .limit(1);
      return winner?.id;
    };

    const insertAttempt = async (attemptNumber: number) =>
      tx
        .insert(bugFixAttempts)
        .values({
          feedbackItemId: primary.id,
          clusterId,
          projectId,
          workspaceId,
          domain: domain ?? null,
          status: "analyzing",
          attemptNumber,
        })
        .returning();

    let attempt: BugFixAttempt | undefined;
    try {
      [attempt] = await insertAttempt(budget.currentCount + 1);
    } catch (error) {
      const kind = getBugFixAttemptUniqueViolationKind(error);

      if (kind === "active") {
        return {
          success: false as const,
          reason: "active_attempt_exists" as const,
          activeAttemptId: await lookupActiveWinner(),
        };
      }

      if (kind === "attempt_number") {
        // Benign race: another tx grabbed the same attempt number. Recompute
        // the budget (which may now also exceed the cap) and retry once.
        const rebudget = await computeClusterRetryBudget(tx, {
          clusterId,
          feedbackItemId: null,
        });
        if (rebudget.isExhausted) {
          return {
            success: false as const,
            reason: "max_attempts_reached" as const,
            budget: rebudget,
          };
        }

        try {
          [attempt] = await insertAttempt(rebudget.currentCount + 1);
        } catch (retryError) {
          const retryKind = getBugFixAttemptUniqueViolationKind(retryError);
          if (retryKind !== null) {
            // The winning tx left an active row or re-collided; surface that
            // so the UI attaches to the existing attempt instead of erroring.
            return {
              success: false as const,
              reason: "active_attempt_exists" as const,
              activeAttemptId: await lookupActiveWinner(),
            };
          }
          throw retryError;
        }
      } else {
        throw error;
      }
    }

    if (!attempt) {
      throw new Error(
        `launchClusterInvestigation: INSERT returned no rows for cluster ${clusterId}`
      );
    }

    // 7. Transition the cluster to `investigating` inline. We duplicate the
    //    body of `transitionCluster` here because that helper opens its own
    //    top-level transaction and cannot be reused as a sub-step. We still
    //    honour its contract (matrix check, history row, updatedAt bump).
    const fromStatus = cluster.status;
    const toStatus: ClusterStatusEnum = "investigating";

    if (!isValidTransition(fromStatus, toStatus)) {
      // Belt-and-braces: `LAUNCH_INVESTIGATION_ALLOWED_STATUSES` is already a
      // subset of transitions the matrix accepts, but if the matrix ever
      // tightens we want to fail loudly via the invalid_state reason rather
      // than corrupt history.
      return {
        success: false as const,
        reason: "invalid_state" as const,
        currentStatus: fromStatus,
      };
    }

    const now = new Date();
    const [updatedCluster] = await tx
      .update(feedbackClusters)
      .set({ status: toStatus, updatedAt: now })
      .where(eq(feedbackClusters.id, clusterId))
      .returning();

    if (!updatedCluster) {
      throw new Error(
        `launchClusterInvestigation: cluster UPDATE returned no rows for ${clusterId}`
      );
    }

    await tx.insert(clusterStatusHistory).values({
      clusterId,
      fromStatus,
      toStatus,
      triggeredByKind: "user",
      triggeredByUserId: userId,
      triggeredByAttemptId: attempt.id,
      reason: "launch-investigation",
      metadata: {},
    });

    return {
      success: true as const,
      attempt,
      cluster: updatedCluster,
      primaryFeedbackItemId: primary.id,
    };
  });
};
