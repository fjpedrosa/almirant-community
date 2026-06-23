// ---------------------------------------------------------------------------
// Ask Feature -- Evaluation Service
// ---------------------------------------------------------------------------
// Heuristic-based quality evaluation for Ask responses. Measures groundedness,
// citation precision/recall, and answer relevance WITHOUT making additional
// LLM calls. Designed for continuous quality monitoring and alerting.
// ---------------------------------------------------------------------------

import { logger } from "@almirant/config";
import type { RankedEvidence } from "./reranker";
import type { AskCitation } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvaluationResult {
  /** Fraction of answer claims supported by evidence (0-1) */
  groundedness: number;
  /** Fraction of cited sources in the answer that exist in citations list (0-1) */
  citationPrecision: number;
  /** Fraction of provided citations actually referenced in the answer (0-1) */
  citationRecall: number;
  /** Heuristic answer relevance score (0-1) */
  answerRelevance: number;
  /** Weighted overall quality score (0-1) */
  overallQuality: number;
}

// ---------------------------------------------------------------------------
// Quality thresholds
// ---------------------------------------------------------------------------

/**
 * Quality thresholds for monitoring and alerting. Scores below these
 * thresholds signal degradation that warrants investigation.
 */
export const QUALITY_THRESHOLDS = {
  /** p95 target -- 95% of responses should score above this */
  p95: 0.8,
  /** p99 target -- 99% of responses should score above this */
  p99: 0.6,
  /** Alert when overall quality drops below this */
  alertThreshold: 0.5,
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Regex to match citation references like [1], [2], [13] in answer text */
const CITATION_REF_REGEX = /\[(\d+)\]/g;

/**
 * Extract all unique citation numbers referenced in the answer text.
 * E.g. "See [1] and [3]" returns Set {1, 3}.
 */
const extractCitationRefs = (text: string): Set<number> => {
  const refs = new Set<number>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(CITATION_REF_REGEX.source, "g");
  while ((match = regex.exec(text)) !== null) {
    const num = parseInt(match[1]!, 10);
    if (num > 0) {
      refs.add(num);
    }
  }
  return refs;
};

// ---------------------------------------------------------------------------
// Evaluation functions
// ---------------------------------------------------------------------------

/**
 * Evaluate groundedness: what fraction of the answer's citation references
 * point to actual evidence items. A well-grounded answer should only reference
 * citations that exist in the ranked evidence list.
 *
 * Heuristic: count of valid citation refs / total citation refs in answer.
 * Returns 1.0 if the answer has no citation refs (vacuously grounded).
 */
export const evaluateGroundedness = (
  answer: string,
  evidence: RankedEvidence[],
): number => {
  const refs = extractCitationRefs(answer);
  if (refs.size === 0) return 1.0;

  const maxValidIndex = evidence.length;
  let supported = 0;

  for (const ref of refs) {
    if (ref >= 1 && ref <= maxValidIndex) {
      supported++;
    }
  }

  return supported / refs.size;
};

/**
 * Evaluate citation precision: what fraction of citation references in the
 * answer actually map to entries in the provided citations list.
 *
 * High precision means the answer does not reference non-existent sources.
 * Returns 1.0 if the answer contains no citation refs.
 */
export const evaluateCitationPrecision = (
  answer: string,
  citations: AskCitation[],
): number => {
  const refs = extractCitationRefs(answer);
  if (refs.size === 0) return 1.0;

  const maxValidIndex = citations.length;
  let valid = 0;

  for (const ref of refs) {
    if (ref >= 1 && ref <= maxValidIndex) {
      valid++;
    }
  }

  return valid / refs.size;
};

/**
 * Evaluate citation recall: what fraction of the provided citations are
 * actually referenced in the answer text.
 *
 * High recall means the answer makes use of most available evidence.
 * Returns 1.0 if no citations were provided (nothing to recall).
 */
export const evaluateCitationRecall = (
  answer: string,
  citations: AskCitation[],
): number => {
  if (citations.length === 0) return 1.0;

  const refs = extractCitationRefs(answer);
  let referenced = 0;

  for (let i = 1; i <= citations.length; i++) {
    if (refs.has(i)) {
      referenced++;
    }
  }

  return referenced / citations.length;
};

/**
 * Heuristic answer relevance: combines answer length adequacy with citation
 * density as a proxy for how well the answer engages with the evidence.
 *
 * - Answers shorter than 50 chars are penalized (likely too terse).
 * - Citation density (refs per 500 chars) rewards evidence-backed answers.
 * - Capped at 1.0.
 */
const evaluateAnswerRelevance = (
  answer: string,
  citations: AskCitation[],
): number => {
  if (!answer || citations.length === 0) return 0;

  // Length adequacy: scale from 0 to 1 between 50 and 500 chars
  const lengthScore = Math.min(1.0, Math.max(0, (answer.length - 50) / 450));

  // Citation density: at least 1 ref per 500 chars is ideal
  const refs = extractCitationRefs(answer);
  const expectedRefs = Math.max(1, Math.floor(answer.length / 500));
  const densityScore = Math.min(1.0, refs.size / expectedRefs);

  // Weighted combination
  return lengthScore * 0.4 + densityScore * 0.6;
};

// ---------------------------------------------------------------------------
// Composite evaluation
// ---------------------------------------------------------------------------

/** Weights for the overall quality composite score */
const QUALITY_WEIGHTS = {
  groundedness: 0.35,
  citationPrecision: 0.25,
  citationRecall: 0.15,
  answerRelevance: 0.25,
} as const;

/**
 * Run the full evaluation suite on an Ask response and compute a weighted
 * overall quality score.
 */
export const evaluateResponse = (
  answer: string,
  evidence: RankedEvidence[],
  citations: AskCitation[],
): EvaluationResult => {
  const groundedness = evaluateGroundedness(answer, evidence);
  const citationPrecision = evaluateCitationPrecision(answer, citations);
  const citationRecall = evaluateCitationRecall(answer, citations);
  const answerRelevance = evaluateAnswerRelevance(answer, citations);

  const overallQuality =
    groundedness * QUALITY_WEIGHTS.groundedness +
    citationPrecision * QUALITY_WEIGHTS.citationPrecision +
    citationRecall * QUALITY_WEIGHTS.citationRecall +
    answerRelevance * QUALITY_WEIGHTS.answerRelevance;

  const result: EvaluationResult = {
    groundedness,
    citationPrecision,
    citationRecall,
    answerRelevance,
    overallQuality: Math.round(overallQuality * 1000) / 1000,
  };

  if (overallQuality < QUALITY_THRESHOLDS.alertThreshold) {
    logger.warn(
      { metric: "ask_quality_alert", ...result },
      "ask: response quality below alert threshold",
    );
  }

  return result;
};
