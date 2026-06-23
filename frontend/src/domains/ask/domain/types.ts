// ---------------------------------------------------------------------------
// Ask feature – Frontend domain types
// ---------------------------------------------------------------------------

// ── Citation & confidence ──────────────────────────────────────────────────

export type AskCitationSourceType =
  | "work_item"
  | "document"
  | "event"
  | "commit"
  | "observation";

export interface AskCitation {
  sourceType: AskCitationSourceType;
  sourceId: string;
  title: string;
  excerpt: string;
  /** ISO-8601 */
  timestamp: string;
}

export type AskConfidenceLevel = "high" | "medium" | "low";

// ── Error codes ────────────────────────────────────────────────────────────

export type AskErrorCode =
  | "INSUFFICIENT_EVIDENCE"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "INVALID_PROJECT"
  | "INTERNAL_ERROR";

// ── Request / Response ─────────────────────────────────────────────────────

export interface AskRequest {
  question: string;
  projectId: string;
  featureId?: string;
  timeRange?: {
    from: string;
    to: string;
  };
  followUpSessionId?: string;
}

export interface AskResponse {
  answer: string;
  confidence: number;
  confidenceLevel: AskConfidenceLevel;
  citations: AskCitation[];
  isAbstention: boolean;
  sessionId: string;
}

// ── UI-specific types ──────────────────────────────────────────────────────

/** Tracks the lifecycle of a single Ask query in the UI */
export type AskQueryState =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "abstained";

/** A single entry in the Ask conversation history */
export interface AskHistoryItem {
  id: string;
  question: string;
  response: AskResponse | null;
  state: AskQueryState;
  errorMessage?: string;
  createdAt: string;
}

// ── Feedback ─────────────────────────────────────────────────────────────

export type AskFeedbackRating = "helpful" | "not_helpful";

export type AskFeedbackCategory =
  | "accuracy"
  | "citations"
  | "relevance"
  | "completeness"
  | "other";

export interface AskFeedbackRequest {
  sessionId: string;
  rating: AskFeedbackRating;
  category?: AskFeedbackCategory;
  comment?: string;
}

/** Filter controls exposed in the Ask UI panel */
export interface AskFilters {
  projectId: string;
  featureId?: string;
  timeRange?: {
    from: string;
    to: string;
  };
}
