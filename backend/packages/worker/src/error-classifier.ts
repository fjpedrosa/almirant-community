/**
 * Error classification for agent job failures.
 *
 * Pure functional module -- no side-effects, no I/O.
 * Classifies error messages and types into structured categories
 * that the orchestrator uses to decide retry/resume strategy.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorType =
  | "quota_exhausted"
  | "rate_limit"
  | "network"
  | "timeout"
  | "auth"
  | "execution_error"
  | "unhandled_callback_error"
  | "unknown";

export interface ErrorClassification {
  /** Canonical error type. */
  type: ErrorType;
  /** Human-readable message (the original or a normalised version). */
  message: string;
  /** Whether this error is worth retrying. */
  retryable: boolean;
  /**
   * If retryable, suggested delay in milliseconds before the next attempt.
   * `undefined` means "use the default backoff schedule".
   */
  retryAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Pattern matchers (order matters -- first match wins)
// ---------------------------------------------------------------------------

interface PatternMatcher {
  type: ErrorType;
  retryable: boolean;
  /** Test against the lower-cased error message. */
  messagePattern?: RegExp;
  /** Test against the error type string (exact match). */
  typeMatch?: string[];
  /** Extract retryAfterMs from the error message when possible. */
  extractRetryMs?: (message: string) => number | undefined;
}

const extractRetrySeconds = (message: string): number | undefined => {
  // Match patterns like "retry after 60s", "retry-after: 120", "wait 30 seconds"
  const match = message.match(
    /(?:retry[\s-]*after|wait)\s*[:=]?\s*(\d+)\s*(?:s(?:ec(?:ond)?s?)?)?/i,
  );
  if (match?.[1]) {
    const seconds = parseInt(match[1], 10);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1_000;
    }
  }
  return undefined;
};

const PATTERNS: PatternMatcher[] = [
  // Quota exhausted -- provider-level spend/token limits
  {
    type: "quota_exhausted",
    retryable: true,
    typeMatch: ["quota_exhausted"],
    messagePattern: /quota[\s_-]*exhaust|spending[\s_-]*limit|budget[\s_-]*exceed/,
    extractRetryMs: extractRetrySeconds,
  },
  // Rate limiting -- request/token rate limits
  {
    type: "rate_limit",
    retryable: true,
    typeMatch: ["rate_limit", "rate_limited", "subscription_limit"],
    messagePattern: /rate[\s_-]*limit|subscription[\s_-]*rate[\s_-]*limit|429|too[\s_-]*many[\s_-]*requests|requests?[\s_-]*per[\s_-]*minute|you['']ve hit your limit/,
    extractRetryMs: extractRetrySeconds,
  },
  // Network errors
  {
    type: "network",
    retryable: true,
    typeMatch: ["network"],
    messagePattern: /econnrefused|econnreset|etimedout|enetunreach|socket[\s_-]*hang[\s_-]*up|dns[\s_-]*lookup|fetch[\s_-]*failed/,
  },
  // Timeout
  {
    type: "timeout",
    retryable: true,
    typeMatch: ["timeout"],
    messagePattern: /timed?\s*out|deadline[\s_-]*exceeded/,
  },
  // Auth errors -- not retryable
  {
    type: "auth",
    retryable: false,
    typeMatch: ["auth", "authentication", "authorization"],
    messagePattern: /unauthorized|forbidden|invalid[\s_-]*(?:api[\s_-]*)?key|401|403/,
  },
];

// ---------------------------------------------------------------------------
// Default retry delays for quota/rate-limit when no explicit value is given
// ---------------------------------------------------------------------------

/** Default delay when quota is exhausted but no retry-after is provided. */
export const DEFAULT_QUOTA_EXHAUSTED_RETRY_MS = 300_000; // 5 minutes

/** Default delay when rate-limited but no retry-after is provided. */
export const DEFAULT_RATE_LIMIT_RETRY_MS = 60_000; // 1 minute

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify an error into a structured category.
 *
 * @param errorMessage  The error message string.
 * @param errorType     Optional error type hint (e.g. from the caller or a previous classification).
 */
export const classifyError = (
  errorMessage: string,
  errorType?: string,
): ErrorClassification => {
  const lowerMessage = errorMessage.toLowerCase();
  const lowerType = errorType?.toLowerCase();

  for (const pattern of PATTERNS) {
    // Check type match first (most specific)
    const typeMatched = lowerType && pattern.typeMatch?.some((t) => t === lowerType);

    // Check message pattern
    const messageMatched = pattern.messagePattern?.test(lowerMessage);

    if (typeMatched || messageMatched) {
      let retryAfterMs = pattern.extractRetryMs?.(errorMessage);

      // Apply defaults for quota/rate-limit when no explicit delay found
      if (retryAfterMs === undefined) {
        if (pattern.type === "quota_exhausted") {
          retryAfterMs = DEFAULT_QUOTA_EXHAUSTED_RETRY_MS;
        } else if (pattern.type === "rate_limit") {
          retryAfterMs = DEFAULT_RATE_LIMIT_RETRY_MS;
        }
      }

      return {
        type: pattern.type,
        message: errorMessage,
        retryable: pattern.retryable,
        retryAfterMs,
      };
    }
  }

  // No pattern matched -- generic execution error
  return {
    type: lowerType === "unhandled_callback_error"
      ? "unhandled_callback_error"
      : (lowerType as ErrorType) ?? "execution_error",
    message: errorMessage,
    retryable: false,
  };
};
