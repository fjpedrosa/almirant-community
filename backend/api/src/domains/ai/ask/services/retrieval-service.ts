// ---------------------------------------------------------------------------
// Ask Feature -- Retrieval Service
// ---------------------------------------------------------------------------
// Core retrieval logic that combines FTS search, direct lookups, and future
// vector search into a unified evidence pipeline. Handles temporal pre-
// filtering, feature timeline enrichment, and result deduplication.
// ---------------------------------------------------------------------------

import { logger } from "@almirant/config";
import {
  searchAskDocuments,
  getAskDocumentsByProject,
  getFeatureTimeline,
  searchObservations,
} from "@almirant/database";
import type { AskDocumentFilters } from "@almirant/database";
import type { QueryPlan } from "./query-planner";
import type { AskCitationSourceType } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum evidence items returned per query */
export const MAX_EVIDENCE_PER_QUERY = 20;

/** Maximum citations included in the final response */
export const MAX_CITATIONS_PER_RESPONSE = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RetrievalMethod = "fts" | "vector" | "direct";

export interface RetrievedEvidence {
  id: string;
  sourceType: AskCitationSourceType;
  sourceId: string;
  title: string;
  content: string | null;
  excerpt: string | null;
  sourceTimestamp: Date | null;
  featureId: string | null;
  metadata: Record<string, unknown> | null;
  /** Normalized relevance score (0-1) */
  relevanceScore: number;
  /** How this evidence was retrieved */
  retrievalMethod: RetrievalMethod;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build AskDocumentFilters from a QueryPlan for the repository layer.
 */
const buildFiltersFromPlan = (plan: QueryPlan): AskDocumentFilters => {
  const filters: AskDocumentFilters = {
    limit: plan.maxResults,
  };

  if (plan.featureId) {
    filters.featureId = plan.featureId;
  }

  if (plan.temporalFilters) {
    filters.timeRange = {
      from: plan.temporalFilters.from,
      to: plan.temporalFilters.to,
    };
  }

  // If there is exactly one source type hint that applies to ask_documents,
  // use it as a hard filter. "observation" comes from a separate table
  // so it is excluded here. Multiple hints are handled post-retrieval.
  const docSourceTypeHints = plan.sourceTypeHints.filter(
    (t) => t !== "observation"
  ) as AskDocumentFilters["sourceType"][];
  if (docSourceTypeHints.length === 1) {
    filters.sourceType = docSourceTypeHints[0];
  }

  return filters;
};

/**
 * Normalize a raw FTS rank value to a 0-1 scale.
 * PostgreSQL ts_rank typically returns values in 0-1 range but can exceed 1
 * for very strong matches. We clamp to [0, 1].
 */
const normalizeFtsRank = (rank: number): number => {
  return Math.min(Math.max(rank, 0), 1);
};

/**
 * Deduplicate evidence by sourceId, keeping the entry with the highest
 * relevance score for each unique source.
 */
const deduplicateBySourceId = (
  evidence: RetrievedEvidence[]
): RetrievedEvidence[] => {
  const bestBySourceId = new Map<string, RetrievedEvidence>();

  for (const item of evidence) {
    const key = `${item.sourceType}:${item.sourceId}`;
    const existing = bestBySourceId.get(key);
    if (!existing || item.relevanceScore > existing.relevanceScore) {
      bestBySourceId.set(key, item);
    }
  }

  return Array.from(bestBySourceId.values());
};

// ---------------------------------------------------------------------------
// Retrieval strategies
// ---------------------------------------------------------------------------

/**
 * Full-text search retrieval using PostgreSQL tsvector.
 */
const retrieveViaFts = async (
  projectId: string,
  plan: QueryPlan
): Promise<RetrievedEvidence[]> => {
  if (!plan.ftsQuery.trim()) {
    return [];
  }

  const filters = buildFiltersFromPlan(plan);

  try {
    const results = await searchAskDocuments(projectId, plan.ftsQuery, filters);

    return results.map((row) => ({
      id: row.id,
      sourceType: row.sourceType as AskCitationSourceType,
      sourceId: row.sourceId,
      title: row.title,
      content: row.content,
      excerpt: row.excerpt,
      sourceTimestamp: row.sourceTimestamp,
      featureId: row.featureId,
      metadata: row.metadata,
      relevanceScore: normalizeFtsRank(Number(row.rank)),
      retrievalMethod: "fts" as const,
    }));
  } catch (error) {
    logger.error({ error, projectId, query: plan.ftsQuery }, "ask: FTS retrieval failed");
    return [];
  }
};

/**
 * Direct retrieval for feature-scoped queries.
 * Fetches the full feature timeline and assigns a base relevance score.
 */
const retrieveFeatureTimeline = async (
  featureId: string
): Promise<RetrievedEvidence[]> => {
  try {
    const timeline = await getFeatureTimeline(featureId);

    return timeline.map((row, index) => ({
      id: row.id,
      sourceType: row.sourceType as AskCitationSourceType,
      sourceId: row.sourceId,
      title: row.title,
      content: null,
      excerpt: row.excerpt,
      sourceTimestamp: row.sourceTimestamp,
      featureId: featureId,
      metadata: row.metadata,
      // Timeline items get a moderate base score, slightly boosted for
      // more recent entries to favor recent context.
      relevanceScore: 0.4 + (index / Math.max(timeline.length, 1)) * 0.1,
      retrievalMethod: "direct" as const,
    }));
  } catch (error) {
    logger.error({ error, featureId }, "ask: feature timeline retrieval failed");
    return [];
  }
};

/**
 * Direct retrieval by project with filters (no search query).
 * Used when FTS returns too few results and we need to backfill.
 */
const retrieveDirectByProject = async (
  projectId: string,
  plan: QueryPlan,
  limit: number
): Promise<RetrievedEvidence[]> => {
  const filters = buildFiltersFromPlan(plan);
  filters.limit = limit;

  try {
    const results = await getAskDocumentsByProject(projectId, filters);

    return results.map((row) => ({
      id: row.id,
      sourceType: row.sourceType as AskCitationSourceType,
      sourceId: row.sourceId,
      title: row.title,
      content: row.content,
      excerpt: row.excerpt,
      sourceTimestamp: row.sourceTimestamp,
      featureId: row.featureId,
      metadata: row.metadata,
      // Direct retrieval without search ranking gets a lower base score
      relevanceScore: 0.3,
      retrievalMethod: "direct" as const,
    }));
  } catch (error) {
    logger.error({ error, projectId }, "ask: direct retrieval failed");
    return [];
  }
};

/**
 * Retrieval from agent memory (agent_observations) using FTS.
 * Returns observations matching the FTS query, scoped to the project.
 */
const retrieveFromObservations = async (
  workspaceId: string,
  projectId: string,
  plan: QueryPlan
): Promise<RetrievedEvidence[]> => {
  if (!plan.ftsQuery.trim()) {
    return [];
  }

  try {
    const results = await searchObservations(workspaceId, plan.ftsQuery, {
      projectId,
      limit: 10,
    });

    return results.map((row) => ({
      id: row.id,
      sourceType: "observation" as AskCitationSourceType,
      sourceId: row.id,
      title: row.title,
      content: row.content,
      excerpt:
        row.content.length > 300
          ? row.content.slice(0, 300) + "..."
          : row.content,
      sourceTimestamp: row.updatedAt,
      featureId: null,
      metadata: {
        observationType: row.type,
        topicKey: row.topicKey,
        scope: row.scope ?? null,
      },
      relevanceScore: 0.45 + normalizeFtsRank(Number(row.rank)) * 0.35,
      retrievalMethod: "fts" as const,
    }));
  } catch (error) {
    logger.error(
      { error, workspaceId, projectId },
      "ask: observation retrieval failed"
    );
    return [];
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main retrieval entry point. Executes the search strategy defined in the
 * QueryPlan, combines results from multiple sources, deduplicates, and
 * returns scored evidence items.
 *
 * Retrieval pipeline:
 * 1. Run FTS search against ask_documents
 * 2. If featureId is provided, also fetch the feature timeline
 * 3. If FTS returns fewer than 5 results, backfill with direct project lookup
 * 4. Combine all results and deduplicate by sourceId
 * 5. Cap at MAX_EVIDENCE_PER_QUERY
 */
export const retrieveEvidence = async (
  projectId: string,
  plan: QueryPlan,
  workspaceId: string
): Promise<RetrievedEvidence[]> => {
  const allEvidence: RetrievedEvidence[] = [];

  // Step 1: Primary FTS retrieval
  if (plan.strategy === "fts_only" || plan.strategy === "hybrid") {
    const ftsResults = await retrieveViaFts(projectId, plan);
    allEvidence.push(...ftsResults);
    logger.debug(
      { count: ftsResults.length, projectId },
      "ask: FTS retrieval completed"
    );
  }

  // Step 2: Feature timeline enrichment
  if (plan.featureId) {
    const timelineResults = await retrieveFeatureTimeline(plan.featureId);
    allEvidence.push(...timelineResults);
    logger.debug(
      { count: timelineResults.length, featureId: plan.featureId },
      "ask: feature timeline retrieval completed"
    );
  }

  // Step 2.5: Agent memory (observations) retrieval
  const observationResults = await retrieveFromObservations(
    workspaceId,
    projectId,
    plan
  );
  allEvidence.push(...observationResults);
  logger.debug(
    { count: observationResults.length, projectId },
    "ask: observation retrieval completed"
  );

  // Step 3: Backfill if FTS returned sparse results
  const MIN_FTS_RESULTS = 5;
  const ftsCount = allEvidence.filter((e) => e.retrievalMethod === "fts").length;
  if (ftsCount < MIN_FTS_RESULTS) {
    const backfillLimit = MAX_EVIDENCE_PER_QUERY - allEvidence.length;
    if (backfillLimit > 0) {
      const directResults = await retrieveDirectByProject(
        projectId,
        plan,
        backfillLimit
      );
      allEvidence.push(...directResults);
      logger.debug(
        { count: directResults.length, projectId },
        "ask: direct backfill retrieval completed"
      );
    }
  }

  // Step 4: Deduplicate
  const deduped = deduplicateBySourceId(allEvidence);

  // Step 5: Cap results
  const capped = deduped
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, MAX_EVIDENCE_PER_QUERY);

  logger.info(
    {
      projectId,
      strategy: plan.strategy,
      totalRetrieved: allEvidence.length,
      afterDedup: deduped.length,
      returned: capped.length,
    },
    "ask: retrieval pipeline completed"
  );

  return capped;
};
