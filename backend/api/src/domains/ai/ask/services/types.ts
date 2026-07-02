// ---------------------------------------------------------------------------
// Ask feature – Backend contract types
// ---------------------------------------------------------------------------

/**
 * Source types that can be cited in an Ask response.
 */
export type AskCitationSourceType =
  | "work_item"
  | "document"
  | "event"
  | "commit"
  | "observation";

/**
 * A single citation pointing back to a piece of evidence used to compose
 * the answer.
 */
export interface AskCitation {
  /** Type of the source entity */
  sourceType: AskCitationSourceType;
  /** Primary key of the source entity */
  sourceId: string;
  /** Human-readable title or label of the source */
  title: string;
  /** Relevant excerpt from the source (may be truncated) */
  excerpt: string;
  /** ISO-8601 timestamp of the source (e.g. commit date, document updated_at) */
  timestamp: string;
}

/**
 * Discrete confidence bands derived from the numeric confidence score.
 *
 * - high:   > 0.8  -- answer is well-supported by evidence
 * - medium: 0.5 .. 0.8 -- answer is partially supported
 * - low:    < 0.5  -- weak evidence; consider abstention
 */
export type AskConfidenceLevel = "high" | "medium" | "low";

/**
 * Maps a numeric confidence value (0-1) to a discrete level.
 */
export const toConfidenceLevel = (score: number): AskConfidenceLevel => {
  if (score > 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
};

/**
 * Abstention threshold: if the confidence score falls below this value the
 * system MUST set `isAbstention = true` and return an explanatory message
 * instead of a speculative answer.
 */
export const ASK_ABSTENTION_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Domain-specific error codes returned in the standard error response body.
 *
 * - INSUFFICIENT_EVIDENCE: not enough data to answer the question
 * - RATE_LIMITED:          caller exceeded the per-minute/hour rate limit
 * - QUOTA_EXCEEDED:        workspace has exhausted its Ask quota
 * - INVALID_PROJECT:       the referenced projectId does not exist or the
 *                          caller has no access
 * - INTERNAL_ERROR:        unexpected server-side failure
 */
export type AskErrorCode =
  | "INSUFFICIENT_EVIDENCE"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "INVALID_PROJECT"
  | "INTERNAL_ERROR";

// ---------------------------------------------------------------------------
// Feedback types
// ---------------------------------------------------------------------------

/**
 * Rating for beta feedback on Ask responses.
 */
export type AskFeedbackRating = "helpful" | "not_helpful";

/**
 * Optional category to classify feedback.
 */
export type AskFeedbackCategory =
  | "accuracy"
  | "citations"
  | "relevance"
  | "completeness"
  | "other";

/**
 * POST /api/ask/feedback – request body.
 */
export interface AskFeedbackRequest {
  /** Session ID of the Ask response being rated */
  sessionId: string;
  /** Whether the response was helpful or not */
  rating: AskFeedbackRating;
  /** Optional category for more structured feedback */
  category?: AskFeedbackCategory;
  /** Optional free-text comment */
  comment?: string;
}

// ---------------------------------------------------------------------------
// Request / Response payloads
// ---------------------------------------------------------------------------

/**
 * POST /api/ask – request body.
 */
export interface AskRequest {
  /** The natural-language question to answer */
  question: string;
  /** Scope the answer to a specific project */
  projectId: string;
  /** Optionally narrow scope to a single feature / epic */
  featureId?: string;
  /** Optional ISO-8601 date range to limit evidence window */
  timeRange?: {
    from: string;
    to: string;
  };
  /** If continuing a conversation, reference the previous session */
  followUpSessionId?: string;
}

/**
 * POST /api/ask – response payload (wrapped in the standard envelope).
 */
export interface AskResponse {
  /** Generated answer text (markdown) */
  answer: string;
  /** Numeric confidence score between 0 and 1 */
  confidence: number;
  /** Discrete confidence band */
  confidenceLevel: AskConfidenceLevel;
  /** Ordered list of citations that back the answer */
  citations: AskCitation[];
  /**
   * When true the system chose NOT to answer because confidence was below
   * the abstention threshold. `answer` will contain an explanation of why
   * the question could not be answered.
   */
  isAbstention: boolean;
  /** Unique session id for follow-up questions */
  sessionId: string;
}
