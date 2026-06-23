import { db } from "../../client";
import {
  feedbackItems,
  feedbackSources,
  feedbackClusters,
} from "../../schema";
import { eq, and, ilike, desc, asc, sql, isNotNull } from "drizzle-orm";
import type { FeedbackItem, NewFeedbackItem } from "../../schema";
import type { PaginationParams } from "../../domain/types";

const BUG_FIX_CLAIM_KEY = "bugFixClaim";

export interface FeedbackItemFilters {
  status?: string;
  category?: string;
  sourceId?: string;
  clusterId?: string;
  search?: string;
  sentiment?: string;
}

export interface FeedbackItemWithRelations extends FeedbackItem {
  source?: { id: string; name: string; type: string } | null;
  cluster?: { id: string; title: string } | null;
}

export const getFeedbackItems = async (
  filters: FeedbackItemFilters,
  pagination: PaginationParams
): Promise<{ items: FeedbackItemWithRelations[]; total: number }> => {
  const conditions = [];

  if (filters.status) {
    conditions.push(eq(feedbackItems.status, filters.status as typeof feedbackItems.status.enumValues[number]));
  }
  if (filters.category) {
    conditions.push(eq(feedbackItems.category, filters.category as typeof feedbackItems.category.enumValues[number]));
  }
  if (filters.sourceId) {
    conditions.push(eq(feedbackItems.sourceId, filters.sourceId));
  }
  if (filters.clusterId) {
    conditions.push(eq(feedbackItems.clusterId, filters.clusterId));
  }
  if (filters.sentiment) {
    conditions.push(eq(feedbackItems.sentiment, filters.sentiment));
  }
  if (filters.search) {
    conditions.push(ilike(feedbackItems.title, `%${filters.search}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [itemsResult, countResult] = await Promise.all([
    db
      .select({
        item: feedbackItems,
        sourceName: feedbackSources.name,
        sourceType: feedbackSources.type,
        clusterTitle: feedbackClusters.title,
      })
      .from(feedbackItems)
      .leftJoin(feedbackSources, eq(feedbackItems.sourceId, feedbackSources.id))
      .leftJoin(feedbackClusters, eq(feedbackItems.clusterId, feedbackClusters.id))
      .where(whereClause)
      .orderBy(desc(feedbackItems.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackItems)
      .where(whereClause),
  ]);

  const items: FeedbackItemWithRelations[] = itemsResult.map((row) => ({
    ...row.item,
    source: row.item.sourceId
      ? { id: row.item.sourceId, name: row.sourceName ?? "", type: row.sourceType ?? "" }
      : null,
    cluster: row.item.clusterId
      ? { id: row.item.clusterId, title: row.clusterTitle ?? "" }
      : null,
  }));

  return {
    items,
    total: countResult[0]?.count ?? 0,
  };
};

export const getFeedbackItemById = async (
  id: string
): Promise<FeedbackItemWithRelations | null> => {
  const [result] = await db
    .select({
      item: feedbackItems,
      sourceName: feedbackSources.name,
      sourceType: feedbackSources.type,
      clusterTitle: feedbackClusters.title,
    })
    .from(feedbackItems)
    .leftJoin(feedbackSources, eq(feedbackItems.sourceId, feedbackSources.id))
    .leftJoin(feedbackClusters, eq(feedbackItems.clusterId, feedbackClusters.id))
    .where(eq(feedbackItems.id, id))
    .limit(1);

  if (!result) return null;

  return {
    ...result.item,
    source: result.item.sourceId
      ? { id: result.item.sourceId, name: result.sourceName ?? "", type: result.sourceType ?? "" }
      : null,
    cluster: result.item.clusterId
      ? { id: result.item.clusterId, title: result.clusterTitle ?? "" }
      : null,
  };
};

export const createFeedbackItem = async (
  data: Omit<NewFeedbackItem, "id" | "createdAt" | "updatedAt">
): Promise<FeedbackItem> => {
  const [newItem] = await db
    .insert(feedbackItems)
    .values(data)
    .returning();

  if (!newItem) throw new Error("Failed to create feedback item");
  return newItem;
};

export const updateFeedbackItem = async (
  id: string,
  data: Partial<Pick<NewFeedbackItem, "status" | "category" | "title" | "content" | "clusterId" | "topicId" | "sentiment" | "metadata" | "promotedWorkItemId" | "aiSuggestedType" | "aiSuggestedTitle" | "aiSuggestedSummary" | "aiCategory" | "aiConfidence" | "aiReasoning" | "aiDomain">>
): Promise<FeedbackItem | null> => {
  const updateValues: Partial<
    Pick<
      NewFeedbackItem,
      | "status"
      | "category"
      | "title"
      | "content"
      | "clusterId"
      | "topicId"
      | "sentiment"
      | "metadata"
      | "promotedWorkItemId"
      | "aiSuggestedType"
      | "aiSuggestedTitle"
      | "aiSuggestedSummary"
      | "aiCategory"
      | "aiConfidence"
      | "aiReasoning"
      | "aiDomain"
    >
  > & { updatedAt: Date } = {
    ...data,
    updatedAt: new Date(),
  };

  if (data.status !== undefined && data.status !== "new") {
    if (data.metadata && typeof data.metadata === "object") {
      const nextMetadata = {
        ...(data.metadata as Record<string, unknown>),
      };
      delete nextMetadata[BUG_FIX_CLAIM_KEY];
      updateValues.metadata = nextMetadata as NewFeedbackItem["metadata"];
    } else if (data.metadata === undefined) {
      const [updated] = await db
        .update(feedbackItems)
        .set({
          ...updateValues,
          metadata: sql`coalesce(${feedbackItems.metadata}, '{}'::jsonb) - ${BUG_FIX_CLAIM_KEY}`,
        })
        .where(eq(feedbackItems.id, id))
        .returning();

      return updated ?? null;
    }
  }

  const [updated] = await db
    .update(feedbackItems)
    .set(updateValues)
    .where(eq(feedbackItems.id, id))
    .returning();

  return updated ?? null;
};

export const deleteFeedbackItem = async (id: string): Promise<boolean> => {
  const result = await db
    .delete(feedbackItems)
    .where(eq(feedbackItems.id, id))
    .returning({ id: feedbackItems.id });

  return result.length > 0;
};

// ──────────────────────────────────────────────
// Embedding persistence
// ──────────────────────────────────────────────
//
// pgvector's vector(1536) column is handled by a customType without driver
// hooks, so the Drizzle `.update({ embedding })` path would pass an untyped
// array that the driver cannot bind. The canonical format is the bracketed
// `[0.1,0.2,...]::vector` literal, same one used by the backfill script.

const vectorToSqlString = (embedding: number[]): string =>
  `[${embedding.join(",")}]`;

export const updateFeedbackItemEmbedding = async (
  id: string,
  embedding: number[]
): Promise<void> => {
  const literal = vectorToSqlString(embedding);
  await db.execute(
    sql`UPDATE feedback_items SET embedding = ${literal}::vector, updated_at = now() WHERE id = ${id}`
  );
};

/**
 * Reads the raw embedding column for a feedback item and returns it as a
 * `number[]`. pgvector serializes vectors as JSON-compatible strings
 * (`[0.1,0.2,...]`), so we parse them defensively.
 */
export const getFeedbackItemEmbedding = async (
  id: string
): Promise<number[] | null> => {
  const rows = (await db.execute(
    sql`SELECT embedding::text AS embedding FROM feedback_items WHERE id = ${id} LIMIT 1`
  )) as unknown as Array<{ embedding: string | null }>;
  const raw = rows[0]?.embedding;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((n) => typeof n === "number")
      ? (parsed as number[])
      : null;
  } catch {
    return null;
  }
};

// ──────────────────────────────────────────────
// Review Inbox (low-confidence triage items)
// ──────────────────────────────────────────────

export interface ReviewInboxFilters {
  status?: string;
  aiDomain?: string;
}

export interface ReviewInboxRow {
  id: string;
  title: string;
  content: string | null;
  authorName: string | null;
  aiCategory: string | null;
  aiConfidence: string | null;
  aiReasoning: string | null;
  suggestedClusterId: string | null;
  suggestedClusterTitle: string | null;
  suggestedTopicId: null;
  suggestedTopicTitle: null;
  createdAt: Date;
}

export const listReviewInbox = async (
  filters: ReviewInboxFilters,
  pagination: PaginationParams
): Promise<{ items: ReviewInboxRow[]; total: number }> => {
  const conditions = [];

  // Default to 'new' status if not specified or if caller passed an invalid
  // value. Passing an invalid enum value straight to the query would make
  // Postgres raise `invalid input value for enum`, surfacing as a 500 instead
  // of a well-behaved empty/default response.
  const requestedStatus = filters.status;
  const validStatuses = feedbackItems.status.enumValues as readonly string[];
  const statusValue =
    requestedStatus && validStatuses.includes(requestedStatus)
      ? requestedStatus
      : "new";
  conditions.push(
    eq(
      feedbackItems.status,
      statusValue as (typeof feedbackItems.status.enumValues)[number]
    )
  );

  // Only items that have been through AI triage (aiConfidence is set)
  conditions.push(isNotNull(feedbackItems.aiConfidence));

  const validAiDomains = feedbackItems.aiDomain.enumValues as readonly string[];
  if (filters.aiDomain && validAiDomains.includes(filters.aiDomain)) {
    conditions.push(
      eq(
        feedbackItems.aiDomain,
        filters.aiDomain as (typeof feedbackItems.aiDomain.enumValues)[number]
      )
    );
  }

  const whereClause = and(...conditions);

  const [itemsResult, countResult] = await Promise.all([
    db
      .select({
        id: feedbackItems.id,
        title: feedbackItems.title,
        content: feedbackItems.content,
        authorName: feedbackItems.authorName,
        aiCategory: feedbackItems.aiCategory,
        aiConfidence: feedbackItems.aiConfidence,
        aiReasoning: feedbackItems.aiReasoning,
        suggestedClusterId: feedbackItems.clusterId,
        suggestedClusterTitle: feedbackClusters.title,
        createdAt: feedbackItems.createdAt,
      })
      .from(feedbackItems)
      .leftJoin(feedbackClusters, eq(feedbackItems.clusterId, feedbackClusters.id))
      .where(whereClause)
      .orderBy(asc(feedbackItems.aiConfidence), asc(feedbackItems.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackItems)
      .where(whereClause),
  ]);

  const items: ReviewInboxRow[] = itemsResult.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    authorName: row.authorName,
    aiCategory: row.aiCategory,
    aiConfidence: row.aiConfidence,
    aiReasoning: row.aiReasoning,
    suggestedClusterId: row.suggestedClusterId,
    suggestedClusterTitle: row.suggestedClusterTitle,
    suggestedTopicId: null,
    suggestedTopicTitle: null,
    createdAt: row.createdAt,
  }));

  return {
    items,
    total: countResult[0]?.count ?? 0,
  };
};

// ──────────────────────────────────────────────
// Cluster-scoped listing (used by MCP tool list_feedback_cluster_items)
// ──────────────────────────────────────────────

export interface FeedbackClusterItemRow {
  id: string;
  title: string;
  content: string | null;
  authorName: string | null;
  aiCategory: string | null;
  createdAt: Date;
}

/**
 * Return all feedback items that belong to a given cluster.
 *
 * Projection is kept intentionally small — the shape matches what the
 * cluster-level bug investigation skill actually consumes as evidence
 * (title, content, author, triage category, timestamp). Ordered by
 * createdAt ASC so the skill can reconstruct the cluster timeline.
 */
export const getByClusterId = async (
  clusterId: string
): Promise<FeedbackClusterItemRow[]> => {
  const rows = await db
    .select({
      id: feedbackItems.id,
      title: feedbackItems.title,
      content: feedbackItems.content,
      authorName: feedbackItems.authorName,
      aiCategory: feedbackItems.aiCategory,
      createdAt: feedbackItems.createdAt,
    })
    .from(feedbackItems)
    .where(eq(feedbackItems.clusterId, clusterId))
    .orderBy(asc(feedbackItems.createdAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    authorName: row.authorName,
    aiCategory: row.aiCategory,
    createdAt: row.createdAt,
  }));
};

export const findRecentFeedbackByDedupeKey = async (
  sourceId: string,
  dedupeKey: string,
  windowSeconds: number
): Promise<FeedbackItem | null> => {
  const [item] = await db
    .select()
    .from(feedbackItems)
    .where(
      and(
        eq(feedbackItems.sourceId, sourceId),
        sql`${feedbackItems.metadata} ->> 'dedupeKey' = ${dedupeKey}`,
        sql`${feedbackItems.createdAt} >= now() - (${windowSeconds} * interval '1 second')`
      )
    )
    .orderBy(desc(feedbackItems.createdAt))
    .limit(1);

  return item ?? null;
};
