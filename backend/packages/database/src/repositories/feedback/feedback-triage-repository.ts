import { db, sql } from "../../client";
import { feedbackItems, feedbackClusters } from "../../schema";
import { eq, inArray } from "drizzle-orm";
import { recalculateClusterItemCount } from "./feedback-cluster-repository";

// ── Types ──

export interface SimilarCluster {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  itemCount: number;
  suggestedType: string | null;
  suggestedPriority: string | null;
  similarity: number;
}

export interface CreateClusterFromFeedbackResult {
  clusterId: string;
  clusterTitle: string;
  feedbackItemId: string;
}

// ── Repository functions ──

/**
 * Find clusters whose embedding is similar to the given vector using pgvector
 * cosine distance. Returns clusters ordered by descending similarity.
 *
 * Only considers clusters with status='open' and a non-null embedding.
 */
export const findSimilarClusters = async (params: {
  embedding: number[];
  limit?: number;
  minSimilarity?: number;
}): Promise<SimilarCluster[]> => {
  const embeddingStr = `[${params.embedding.join(",")}]`;
  const limit = params.limit ?? 5;
  const minSimilarity = params.minSimilarity ?? 0.7;

  const rows = await db.execute(sql`
    SELECT
      id,
      title,
      summary,
      status,
      item_count,
      suggested_type,
      suggested_priority,
      1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM feedback_clusters
    WHERE status = 'open'
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> ${embeddingStr}::vector) >= ${minSimilarity}
    ORDER BY similarity DESC
    LIMIT ${limit}
  `);

  return (rows as unknown as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    summary: (row.summary as string) ?? null,
    status: row.status as string,
    itemCount: Number(row.item_count),
    suggestedType: (row.suggested_type as string) ?? null,
    suggestedPriority: (row.suggested_priority as string) ?? null,
    similarity: Number(row.similarity),
  }));
};

/**
 * Assign a feedback item to an existing cluster atomically.
 *
 * In a single transaction:
 * 1. Updates the feedback item: sets clusterId, aiConfidence, aiReasoning,
 *    and transitions status to 'triaged' if confidence is high enough
 *    (otherwise marks requiresReview = true).
 * 2. Increments the cluster's itemCount.
 */
export const assignFeedbackToCluster = async (params: {
  feedbackItemId: string;
  clusterId: string;
  aiConfidence: number;
  aiReasoning: string;
}): Promise<{ feedbackItemId: string; clusterId: string; status: string; requiresReview: boolean }> => {
  const CONFIDENCE_THRESHOLD = 0.75;
  const isHighConfidence = params.aiConfidence >= CONFIDENCE_THRESHOLD;
  const newStatus = isHighConfidence ? "triaged" : "new";
  const requiresReview = !isHighConfidence;

  return await db.transaction(async (tx) => {
    // 1. Update the feedback item
    const [updatedItem] = await tx
      .update(feedbackItems)
      .set({
        clusterId: params.clusterId,
        aiConfidence: String(params.aiConfidence),
        aiReasoning: params.aiReasoning,
        status: newStatus,
        requiresReview,
        updatedAt: new Date(),
      })
      .where(eq(feedbackItems.id, params.feedbackItemId))
      .returning({
        id: feedbackItems.id,
        status: feedbackItems.status,
        requiresReview: feedbackItems.requiresReview,
      });

    if (!updatedItem) {
      throw new Error(`Feedback item '${params.feedbackItemId}' not found`);
    }

    // 2. Increment the cluster's item count
    const [updatedCluster] = await tx
      .update(feedbackClusters)
      .set({
        itemCount: sql`${feedbackClusters.itemCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(feedbackClusters.id, params.clusterId))
      .returning({ id: feedbackClusters.id });

    if (!updatedCluster) {
      throw new Error(`Feedback cluster '${params.clusterId}' not found`);
    }

    return {
      feedbackItemId: updatedItem.id,
      clusterId: params.clusterId,
      status: updatedItem.status,
      requiresReview: updatedItem.requiresReview,
    };
  });
};

/**
 * Create a new cluster from a feedback item and assign the item to it
 * in a single transaction.
 *
 * 1. Inserts a new feedback_clusters row with the given embedding and metadata.
 * 2. Updates the feedback item to point to the new cluster.
 */
export const createClusterFromFeedback = async (params: {
  feedbackItemId: string;
  title: string;
  summary: string;
  suggestedType?: string;
  suggestedPriority?: string;
  embedding: number[];
}): Promise<CreateClusterFromFeedbackResult> => {
  const embeddingStr = `[${params.embedding.join(",")}]`;

  return await db.transaction(async (tx) => {
    // 1. Create the cluster
    const [newCluster] = await tx.execute(sql`
      INSERT INTO feedback_clusters (title, summary, item_count, status, suggested_type, suggested_priority, embedding)
      VALUES (
        ${params.title},
        ${params.summary},
        1,
        'open',
        ${params.suggestedType ?? null},
        ${params.suggestedPriority ?? null},
        ${embeddingStr}::vector
      )
      RETURNING id, title
    `) as unknown as { id: string; title: string }[];

    if (!newCluster) {
      throw new Error("Failed to create feedback cluster");
    }

    // 2. Assign the feedback item to the new cluster
    const [updatedItem] = await tx
      .update(feedbackItems)
      .set({
        clusterId: newCluster.id,
        status: "triaged",
        updatedAt: new Date(),
      })
      .where(eq(feedbackItems.id, params.feedbackItemId))
      .returning({ id: feedbackItems.id });

    if (!updatedItem) {
      throw new Error(`Feedback item '${params.feedbackItemId}' not found`);
    }

    return {
      clusterId: newCluster.id,
      clusterTitle: newCluster.title,
      feedbackItemId: updatedItem.id,
    };
  });
};

// ──────────────────────────────────────────────────────────────────────────
// Batch triage (A-1916)
//
// Applies a batch of triage decisions in a single call. Each group represents
// one cluster's worth of items (either an existing cluster to assign to, or
// a brand-new cluster to create). Per-item AI fields live in `perItem` and are
// written inside the same transaction as the cluster assignment.
//
// Commit-per-group semantics: a failing group does NOT roll back previously
// applied groups. Callers get a discriminated `{ applied, failed }` summary
// so the caller UI can surface partial success.
// ──────────────────────────────────────────────────────────────────────────

export type BatchTriageGroup =
  | {
      kind: "assign_existing";
      clusterId: string;
      feedbackItemIds: string[];
    }
  | {
      kind: "create_new";
      title: string;
      summary: string;
      suggestedType?: string;
      suggestedPriority?: string;
      embedding: number[];
      feedbackItemIds: string[];
    };

export interface BatchTriagePerItemFields {
  aiCategory: string;
  aiDomain: string;
  aiSuggestedType: string;
  aiSuggestedTitle: string;
  aiSuggestedSummary: string;
  aiConfidence: number;
  aiReasoning: string;
}

export interface BatchTriageApplied {
  clusterId: string;
  clusterTitle: string | null;
  feedbackItemIds: string[];
  created: boolean;
}

export interface BatchTriageFailed {
  feedbackItemIds: string[];
  error: string;
}

export interface ApplyBatchTriageDecisionsResult {
  applied: BatchTriageApplied[];
  failed: BatchTriageFailed[];
}

const CONFIDENCE_THRESHOLD = 0.75;

const buildItemUpdateSet = (
  clusterId: string,
  perItem: BatchTriagePerItemFields,
) => {
  const isHighConfidence = perItem.aiConfidence >= CONFIDENCE_THRESHOLD;
  return {
    clusterId,
    status: isHighConfidence ? ("triaged" as const) : ("new" as const),
    requiresReview: !isHighConfidence,
    aiCategory: perItem.aiCategory as never,
    aiDomain: perItem.aiDomain as never,
    aiSuggestedType: perItem.aiSuggestedType as never,
    aiSuggestedTitle: perItem.aiSuggestedTitle,
    aiSuggestedSummary: perItem.aiSuggestedSummary,
    aiConfidence: perItem.aiConfidence.toFixed(2),
    aiReasoning: perItem.aiReasoning,
    updatedAt: new Date(),
  };
};

export const applyBatchTriageDecisions = async (params: {
  groups: BatchTriageGroup[];
  perItem: Record<string, BatchTriagePerItemFields>;
}): Promise<ApplyBatchTriageDecisionsResult> => {
  const applied: BatchTriageApplied[] = [];
  const failed: BatchTriageFailed[] = [];
  const touchedClusterIds = new Set<string>();

  for (const group of params.groups) {
    if (group.feedbackItemIds.length === 0) continue;

    // Ensure every feedback item in the group has a perItem entry before we
    // open a transaction -- missing fields would otherwise silently drop AI
    // data and leave rows half-populated.
    const missing = group.feedbackItemIds.filter((id) => !params.perItem[id]);
    if (missing.length > 0) {
      failed.push({
        feedbackItemIds: group.feedbackItemIds,
        error: `missing_per_item_fields_for: ${missing.join(",")}`,
      });
      continue;
    }

    try {
      const result = await db.transaction(async (tx) => {
        let clusterId: string;
        let clusterTitle: string | null;
        let created = false;

        if (group.kind === "assign_existing") {
          const [existing] = await tx
            .select({ id: feedbackClusters.id, title: feedbackClusters.title })
            .from(feedbackClusters)
            .where(eq(feedbackClusters.id, group.clusterId))
            .limit(1);
          if (!existing) {
            throw new Error(
              `cluster_not_found: ${group.clusterId}`,
            );
          }
          clusterId = existing.id;
          clusterTitle = existing.title;
        } else {
          const embeddingStr = `[${group.embedding.join(",")}]`;
          const [newCluster] = (await tx.execute(sql`
            INSERT INTO feedback_clusters (
              title, summary, item_count, status,
              suggested_type, suggested_priority, embedding
            )
            VALUES (
              ${group.title},
              ${group.summary},
              0,
              'open',
              ${group.suggestedType ?? null},
              ${group.suggestedPriority ?? null},
              ${embeddingStr}::vector
            )
            RETURNING id, title
          `)) as unknown as { id: string; title: string }[];
          if (!newCluster) {
            throw new Error("cluster_insert_failed");
          }
          clusterId = newCluster.id;
          clusterTitle = newCluster.title;
          created = true;
        }

        for (const itemId of group.feedbackItemIds) {
          const perItem = params.perItem[itemId]!;
          const [updated] = await tx
            .update(feedbackItems)
            .set(buildItemUpdateSet(clusterId, perItem))
            .where(eq(feedbackItems.id, itemId))
            .returning({ id: feedbackItems.id });
          if (!updated) {
            throw new Error(`feedback_item_not_found: ${itemId}`);
          }
        }

        return { clusterId, clusterTitle, created };
      });

      touchedClusterIds.add(result.clusterId);
      applied.push({
        clusterId: result.clusterId,
        clusterTitle: result.clusterTitle,
        feedbackItemIds: group.feedbackItemIds,
        created: result.created,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ feedbackItemIds: group.feedbackItemIds, error: message });
    }
  }

  // Recompute item counts for every cluster we touched. Running this outside
  // the per-group transactions keeps the aggregate consistent even when some
  // groups succeed and others fail.
  for (const clusterId of touchedClusterIds) {
    try {
      await recalculateClusterItemCount(clusterId);
    } catch {
      // Non-fatal: counts can be reconciled by the nightly recompute job.
    }
  }

  return { applied, failed };
};

/**
 * Bulk-load feedback items by id. Used by the batch-triage MCP tool to fetch
 * N items in one round-trip before running embeddings + cluster lookup.
 */
export const getFeedbackItemsByIds = async (
  ids: string[],
): Promise<Array<typeof feedbackItems.$inferSelect>> => {
  if (ids.length === 0) return [];
  return await db
    .select()
    .from(feedbackItems)
    .where(inArray(feedbackItems.id, ids));
};

/**
 * Bulk-load embeddings for a list of feedback items. Returns a Map keyed by
 * feedback item id. Items without an embedding are simply absent from the map.
 */
export const getFeedbackItemEmbeddings = async (
  ids: string[],
): Promise<Map<string, number[]>> => {
  const result = new Map<string, number[]>();
  if (ids.length === 0) return result;

  const rows = (await db.execute(sql`
    SELECT id, embedding::text AS embedding
    FROM feedback_items
    WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND embedding IS NOT NULL
  `)) as unknown as Array<{ id: string; embedding: string }>;

  for (const row of rows) {
    if (!row.embedding) continue;
    // pgvector serializes as "[0.1,0.2,...]"
    const parsed = JSON.parse(row.embedding) as number[];
    result.set(row.id, parsed);
  }
  return result;
};
