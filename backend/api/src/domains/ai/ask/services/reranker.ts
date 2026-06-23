// ---------------------------------------------------------------------------
// Ask Feature -- Reranker
// ---------------------------------------------------------------------------
// Post-retrieval reranking pipeline that applies source diversity, temporal
// recency boosts, score normalization, and deduplication to produce a final
// ranked list of evidence items with an overall confidence score.
// ---------------------------------------------------------------------------

import { logger } from "@almirant/config";
import type { RetrievedEvidence } from "./retrieval-service";
import type { AskCitationSourceType } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RankFactors {
  /** Original relevance score from retrieval */
  baseRelevance: number;
  /** Boost/penalty from source diversity balancing */
  diversityFactor: number;
  /** Boost from temporal recency */
  recencyFactor: number;
}

export interface RankedEvidence extends RetrievedEvidence {
  /** Combined final score after all reranking factors */
  finalScore: number;
  /** Breakdown of individual ranking factors */
  rankFactors: RankFactors;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum share of results from a single source type */
const MAX_SOURCE_TYPE_SHARE = 0.5;

/** Weight for the base relevance score */
const WEIGHT_BASE_RELEVANCE = 0.7;

/** Weight for the diversity factor */
const WEIGHT_DIVERSITY = 0.15;

/** Weight for the recency factor */
const WEIGHT_RECENCY = 0.15;

/**
 * Maximum age in days for recency scoring.
 * Evidence older than this gets zero recency boost.
 */
const RECENCY_MAX_AGE_DAYS = 90;

// ---------------------------------------------------------------------------
// Internal functions
// ---------------------------------------------------------------------------

/**
 * Deduplicate evidence by sourceId, keeping the entry with the highest
 * relevance score for each unique source.
 */
const deduplicateEvidence = (
  evidence: RetrievedEvidence[]
): RetrievedEvidence[] => {
  const bestBySource = new Map<string, RetrievedEvidence>();

  for (const item of evidence) {
    const key = `${item.sourceType}:${item.sourceId}`;
    const existing = bestBySource.get(key);
    if (!existing || item.relevanceScore > existing.relevanceScore) {
      bestBySource.set(key, item);
    }
  }

  return Array.from(bestBySource.values());
};

/**
 * Compute the diversity factor for each evidence item.
 *
 * If a single source type exceeds MAX_SOURCE_TYPE_SHARE of total results,
 * items of that type get a penalty while underrepresented types get a boost.
 */
const computeDiversityFactors = (
  evidence: RetrievedEvidence[]
): Map<string, number> => {
  const total = evidence.length;
  if (total === 0) return new Map();

  // Count items per source type
  const typeCounts = new Map<AskCitationSourceType, number>();
  for (const item of evidence) {
    typeCounts.set(item.sourceType, (typeCounts.get(item.sourceType) ?? 0) + 1);
  }

  // Compute factor per item
  const factors = new Map<string, number>();
  for (const item of evidence) {
    const typeCount = typeCounts.get(item.sourceType) ?? 0;
    const typeShare = typeCount / total;

    let factor: number;
    if (typeShare > MAX_SOURCE_TYPE_SHARE) {
      // Penalize overrepresented types proportionally
      factor = MAX_SOURCE_TYPE_SHARE / typeShare;
    } else {
      // Slight boost for underrepresented types
      factor = 1.0 + (1.0 - typeShare) * 0.2;
    }

    factors.set(item.id, Math.min(factor, 1.2));
  }

  return factors;
};

/**
 * Compute a recency factor (0-1) based on how recent the evidence is.
 * More recent evidence gets a higher factor.
 */
const computeRecencyFactor = (
  sourceTimestamp: Date | null,
  now: Date
): number => {
  if (!sourceTimestamp) return 0.5; // Neutral score for undated evidence

  const ageMs = now.getTime() - sourceTimestamp.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays < 0) return 1.0; // Future-dated evidence (edge case)
  if (ageDays > RECENCY_MAX_AGE_DAYS) return 0.0;

  // Linear decay from 1.0 to 0.0 over RECENCY_MAX_AGE_DAYS
  return 1.0 - ageDays / RECENCY_MAX_AGE_DAYS;
};

/**
 * Compute the final combined score from individual factors.
 */
const computeFinalScore = (factors: RankFactors): number => {
  const score =
    factors.baseRelevance * WEIGHT_BASE_RELEVANCE +
    factors.diversityFactor * WEIGHT_DIVERSITY +
    factors.recencyFactor * WEIGHT_RECENCY;

  // Clamp to [0, 1]
  return Math.min(Math.max(score, 0), 1);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rerank retrieved evidence through a multi-factor scoring pipeline:
 *
 * 1. Deduplicate by sourceId (keep highest scored)
 * 2. Compute source diversity factors (penalize overrepresented types)
 * 3. Compute temporal recency boosts
 * 4. Combine scores with weighted formula
 * 5. Sort by final score descending
 * 6. Return top N results
 */
export const rerankEvidence = (
  evidence: RetrievedEvidence[],
  _query: string,
  maxResults: number = 10
): RankedEvidence[] => {
  if (evidence.length === 0) return [];

  const now = new Date();

  // Step 1: Deduplicate
  const deduped = deduplicateEvidence(evidence);

  // Step 2: Compute diversity factors
  const diversityFactors = computeDiversityFactors(deduped);

  // Step 3-4: Score each item
  const ranked: RankedEvidence[] = deduped.map((item) => {
    const rankFactors: RankFactors = {
      baseRelevance: item.relevanceScore,
      diversityFactor: diversityFactors.get(item.id) ?? 1.0,
      recencyFactor: computeRecencyFactor(item.sourceTimestamp, now),
    };

    return {
      ...item,
      finalScore: computeFinalScore(rankFactors),
      rankFactors,
    };
  });

  // Step 5: Sort by final score descending
  ranked.sort((a, b) => b.finalScore - a.finalScore);

  // Step 6: Apply source diversity cap -- ensure no single source type
  // exceeds MAX_SOURCE_TYPE_SHARE in the final results
  const result = applyDiversityCap(ranked, maxResults);

  logger.debug(
    {
      inputCount: evidence.length,
      afterDedup: deduped.length,
      outputCount: result.length,
      topScore: result[0]?.finalScore ?? 0,
    },
    "ask: reranking completed"
  );

  return result;
};

/**
 * Apply a diversity cap to ensure no single source type dominates the
 * final result set beyond MAX_SOURCE_TYPE_SHARE.
 */
const applyDiversityCap = (
  sorted: RankedEvidence[],
  maxResults: number
): RankedEvidence[] => {
  const result: RankedEvidence[] = [];
  const typeCountInResult = new Map<AskCitationSourceType, number>();
  const maxPerType = Math.ceil(maxResults * MAX_SOURCE_TYPE_SHARE);

  for (const item of sorted) {
    if (result.length >= maxResults) break;

    const currentCount = typeCountInResult.get(item.sourceType) ?? 0;
    if (currentCount >= maxPerType) {
      // Skip this item to maintain diversity, but keep scanning
      continue;
    }

    result.push(item);
    typeCountInResult.set(item.sourceType, currentCount + 1);
  }

  // If we did not fill maxResults due to diversity caps, backfill from
  // remaining items regardless of type
  if (result.length < maxResults) {
    const resultIds = new Set(result.map((r) => r.id));
    for (const item of sorted) {
      if (result.length >= maxResults) break;
      if (!resultIds.has(item.id)) {
        result.push(item);
      }
    }
  }

  return result;
};

/**
 * Compute an overall confidence score (0-1) for the answer based on
 * the quality and coverage of the ranked evidence.
 *
 * Factors:
 * - Number of supporting evidence items (more = higher confidence)
 * - Average relevance score of top evidence
 * - Source diversity (evidence from multiple source types)
 * - Temporal coverage (evidence spanning different time periods)
 */
export const computeConfidence = (ranked: RankedEvidence[]): number => {
  if (ranked.length === 0) return 0;

  // Factor 1: Evidence count (0-1), saturates at 10 items
  const countFactor = Math.min(ranked.length / 10, 1.0);

  // Factor 2: Average final score of top 5 items
  const topN = ranked.slice(0, 5);
  const avgScore =
    topN.reduce((sum, item) => sum + item.finalScore, 0) / topN.length;

  // Factor 3: Source diversity -- ratio of unique source types to max possible (5)
  const uniqueTypes = new Set(ranked.map((r) => r.sourceType));
  const diversityFactor = Math.min(uniqueTypes.size / 4, 1.0);

  // Factor 4: Temporal coverage
  const timestamps = ranked
    .filter((r) => r.sourceTimestamp !== null)
    .map((r) => r.sourceTimestamp!.getTime());

  let temporalFactor = 0.5; // Default when no timestamps
  if (timestamps.length >= 2) {
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);
    const spanDays = (maxTs - minTs) / (1000 * 60 * 60 * 24);
    // Wider temporal span (up to 30 days) indicates better coverage
    temporalFactor = Math.min(spanDays / 30, 1.0);
  }

  // Weighted combination
  const confidence =
    avgScore * 0.45 +
    countFactor * 0.25 +
    diversityFactor * 0.15 +
    temporalFactor * 0.15;

  return Math.min(Math.max(confidence, 0), 1);
};
