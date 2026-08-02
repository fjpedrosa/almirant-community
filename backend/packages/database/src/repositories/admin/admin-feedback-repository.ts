import { db } from "../../client";
import {
  feedbackItems,
  feedbackSources,
  feedbackClusters,
} from "../../schema";
import { eq, and, ilike, desc, sql, inArray } from "drizzle-orm";
import type { PaginationParams } from "../../domain/types";
import type { FeedbackItemWithRelations } from "../feedback/feedback-item-repository";

// -------------------------------------------------------
// Admin Feedback Items
//
// Feedback is mono-project by definition (the Almirant project). The
// `projectId` filter was dropped because it was meaningless — the table no
// longer carries that column.
// -------------------------------------------------------

export interface AdminFeedbackItemFilters {
  status?: string;
  category?: string;
  sourceId?: string;
  clusterId?: string;
  search?: string;
  sentiment?: string;
}

export const getAdminFeedbackItems = async (
  filters: AdminFeedbackItemFilters,
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

// -------------------------------------------------------
// Admin Feedback Sources
// -------------------------------------------------------

export const getAdminFeedbackSources = async (
  pagination: PaginationParams
): Promise<{ sources: import("../../schema").FeedbackSource[]; total: number }> => {

  const [sourcesResult, countResult] = await Promise.all([
    db
      .select()
      .from(feedbackSources)
      .orderBy(desc(feedbackSources.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackSources),
  ]);

  return {
    sources: sourcesResult,
    total: countResult[0]?.count ?? 0,
  };
};

// -------------------------------------------------------
// Admin Feedback Clusters
// -------------------------------------------------------

export interface AdminFeedbackClusterFilters {
  statuses?: string[];
}

export const getAdminFeedbackClusters = async (
  filters: AdminFeedbackClusterFilters,
  pagination: PaginationParams
): Promise<{ clusters: import("../../schema").FeedbackCluster[]; total: number }> => {
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

// -------------------------------------------------------
// Admin Feedback Stats (cross-project aggregate)
// -------------------------------------------------------

export interface AdminFeedbackStats {
  totalItems: number;
  totalSources: number;
  totalClusters: number;
  itemsByStatus: Record<string, number>;
  itemsByCategory: Record<string, number>;
}

export const getAdminFeedbackStats = async (): Promise<AdminFeedbackStats> => {
  const [
    totalItemsResult,
    totalSourcesResult,
    totalClustersResult,
    statusResult,
    categoryResult,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackItems),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackSources),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackClusters),
    db
      .select({
        status: feedbackItems.status,
        count: sql<number>`count(*)::int`,
      })
      .from(feedbackItems)
      .groupBy(feedbackItems.status),
    db
      .select({
        category: feedbackItems.category,
        count: sql<number>`count(*)::int`,
      })
      .from(feedbackItems)
      .groupBy(feedbackItems.category),
  ]);

  const itemsByStatus: Record<string, number> = {};
  for (const row of statusResult) {
    itemsByStatus[row.status] = row.count;
  }

  const itemsByCategory: Record<string, number> = {};
  for (const row of categoryResult) {
    itemsByCategory[row.category] = row.count;
  }

  return {
    totalItems: totalItemsResult[0]?.count ?? 0,
    totalSources: totalSourcesResult[0]?.count ?? 0,
    totalClusters: totalClustersResult[0]?.count ?? 0,
    itemsByStatus,
    itemsByCategory,
  };
};
