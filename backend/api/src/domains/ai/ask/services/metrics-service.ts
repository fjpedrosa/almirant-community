// ---------------------------------------------------------------------------
// Ask Feature -- Metrics Service
// ---------------------------------------------------------------------------
// Operational observability for the Ask pipeline. Provides structured metric
// recording via Pino (suitable for Grafana / DataDog ingestion), per-stage
// latency timers, and a rough token estimator.
// ---------------------------------------------------------------------------

import { logger } from "@almirant/config";
import type { SearchStrategy } from "./query-planner";
import type { AskConfidenceLevel } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AskMetrics {
  /** Length of the original question in characters */
  questionLength: number;
  /** Project scope */
  projectId: string;
  /** Search strategy chosen by the query planner */
  strategy: SearchStrategy;
  /** Time spent in the retrieval stage (ms) */
  retrievalTimeMs: number;
  /** Time spent in the reranking stage (ms) */
  rerankTimeMs: number;
  /** Time spent in LLM synthesis (ms) */
  synthesisTimeMs: number;
  /** Total orchestration wall-time (ms) */
  totalTimeMs: number;
  /** Number of raw evidence items returned by retrieval */
  evidenceCount: number;
  /** Number of items after reranking / truncation */
  rankedCount: number;
  /** Numeric confidence score (0-1) */
  confidence: number;
  /** Discrete confidence band */
  confidenceLevel: AskConfidenceLevel;
  /** Whether the system abstained from answering */
  isAbstention: boolean;
  /** Number of citations in the final response */
  citationCount: number;
  /** Rough token estimate for the synthesized answer */
  tokenEstimate: number;
  /** LLM model used for synthesis */
  model: string;
}

// ---------------------------------------------------------------------------
// Timer utility
// ---------------------------------------------------------------------------

export interface StageTimer {
  /** Mark the start of a named stage */
  start: (stage: string) => void;
  /** Mark the end of a named stage and return elapsed ms */
  end: (stage: string) => number;
  /** Return all completed stage timings */
  getAll: () => Record<string, number>;
}

/**
 * Creates a lightweight timer that tracks per-stage latency using
 * `performance.now()` for sub-millisecond precision.
 */
export const createAskTimer = (): StageTimer => {
  const starts = new Map<string, number>();
  const durations = new Map<string, number>();

  return {
    start(stage: string): void {
      starts.set(stage, performance.now());
    },

    end(stage: string): number {
      const startTime = starts.get(stage);
      if (startTime === undefined) {
        logger.warn({ stage }, "ask-metrics: end() called without matching start()");
        return 0;
      }
      const elapsed = Math.round((performance.now() - startTime) * 100) / 100;
      durations.set(stage, elapsed);
      starts.delete(stage);
      return elapsed;
    },

    getAll(): Record<string, number> {
      return Object.fromEntries(durations);
    },
  };
};

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Rough token estimator based on the common heuristic of ~4 characters per
 * token for English text. Suitable for cost estimation, NOT for prompt
 * budgeting.
 */
export const estimateTokens = (text: string): number => {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
};

// ---------------------------------------------------------------------------
// Metric recording
// ---------------------------------------------------------------------------

/**
 * Emit a structured log line containing all Ask pipeline metrics. The log
 * entry uses a stable `metric` field so it can be picked up by log-based
 * metric pipelines (Grafana Loki, DataDog Logs, etc.).
 */
export const recordAskMetrics = (metrics: AskMetrics): void => {
  logger.info(
    {
      metric: "ask_pipeline",
      questionLength: metrics.questionLength,
      projectId: metrics.projectId,
      strategy: metrics.strategy,
      retrievalTimeMs: metrics.retrievalTimeMs,
      rerankTimeMs: metrics.rerankTimeMs,
      synthesisTimeMs: metrics.synthesisTimeMs,
      totalTimeMs: metrics.totalTimeMs,
      evidenceCount: metrics.evidenceCount,
      rankedCount: metrics.rankedCount,
      confidence: metrics.confidence,
      confidenceLevel: metrics.confidenceLevel,
      isAbstention: metrics.isAbstention,
      citationCount: metrics.citationCount,
      tokenEstimate: metrics.tokenEstimate,
      model: metrics.model,
    },
    "ask: pipeline metrics recorded",
  );
};
