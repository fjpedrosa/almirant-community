// ---------------------------------------------------------------------------
// Ask Feature -- Frontend metrics display hook
// ---------------------------------------------------------------------------
// Derives display-friendly quality metrics from an AskResponse for use in
// UI components that show confidence badges, citation counts, etc.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import type { AskResponse, AskConfidenceLevel } from "../../domain/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AskMetricsDisplay {
  /** Numeric confidence score (0-1) */
  confidence: number;
  /** Human-readable confidence band */
  confidenceLevel: AskConfidenceLevel;
  /** Number of citations backing the answer */
  citationCount: number;
  /** Whether the system abstained from answering */
  isAbstention: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Derives display-ready metrics from an AskResponse. Returns null when no
 * response is available yet. All values are computed once and memoized.
 */
export const useAskMetrics = (
  response: AskResponse | null,
): AskMetricsDisplay | null => {
  return useMemo(() => {
    if (!response) return null;

    return {
      confidence: response.confidence,
      confidenceLevel: response.confidenceLevel,
      citationCount: response.citations.length,
      isAbstention: response.isAbstention,
    };
  }, [response]);
};
