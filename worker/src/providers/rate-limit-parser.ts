/**
 * Multi-provider rate limit parser module.
 *
 * Provides parsers for extracting rate limit information from HTTP response
 * headers of different AI providers (Anthropic, OpenAI, etc.).
 *
 * Since the Claude Agent SDK does not expose raw HTTP headers directly, the
 * Claude Code provider uses a reactive approach: it captures rate limit info
 * from SDK error messages (SDKAssistantMessage with error === "rate_limit")
 * and from error text content when available.
 *
 * The header-based parsers are still useful for:
 *  - Direct Anthropic/OpenAI API integrations outside the SDK
 *  - Future SDK versions that may expose headers
 *  - Parsing headers from webhook/proxy interceptors
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitInfo {
  /** Provider identifier (e.g. "anthropic", "openai") */
  provider: string;
  /** Maximum tokens allowed in the rate limit window */
  tokensLimit?: number;
  /** Tokens remaining before rate limit is hit */
  tokensRemaining?: number;
  /** When the token rate limit resets */
  tokensReset?: Date;
  /** Maximum requests allowed in the rate limit window */
  requestsLimit?: number;
  /** Requests remaining before rate limit is hit */
  requestsRemaining?: number;
  /** When the request rate limit resets */
  requestsReset?: Date;
  /** Seconds to wait before retrying (from retry-after header or error body) */
  retryAfterSeconds?: number;
  /** When this rate limit info was captured */
  capturedAt: Date;
}

/** Serializable version of RateLimitInfo for AgentResult (dates as ISO strings) */
export interface RateLimitInfoSerialized {
  provider: string;
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensReset?: string;
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsReset?: string;
  retryAfterSeconds?: number;
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely parse a string to an integer, returning undefined on failure. */
const safeParseInt = (value: string | undefined | null): number | undefined => {
  if (value == null) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Parse an ISO 8601 date string, returning undefined on failure. */
const safeParseDate = (value: string | undefined | null): Date | undefined => {
  if (value == null) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/**
 * Parse an OpenAI-style duration string (e.g. "6m0s", "1h2m3s", "500ms") to a Date
 * relative to now.
 */
const parseDurationToDate = (value: string | undefined | null): Date | undefined => {
  if (value == null) return undefined;

  let totalMs = 0;
  const hourMatch = value.match(/(\d+)h/);
  const minMatch = value.match(/(\d+)m(?!s)/);
  const secMatch = value.match(/(\d+)s/);
  const msMatch = value.match(/(\d+)ms/);

  if (hourMatch) totalMs += parseInt(hourMatch[1], 10) * 3_600_000;
  if (minMatch) totalMs += parseInt(minMatch[1], 10) * 60_000;
  if (secMatch) totalMs += parseInt(secMatch[1], 10) * 1_000;
  if (msMatch) totalMs += parseInt(msMatch[1], 10);

  return totalMs > 0 ? new Date(Date.now() + totalMs) : undefined;
};

// ---------------------------------------------------------------------------
// Anthropic header parser
// ---------------------------------------------------------------------------

/**
 * Parse Anthropic rate limit headers.
 *
 * Headers reference (https://docs.anthropic.com/en/api/rate-limits#response-headers):
 *  - anthropic-ratelimit-tokens-limit
 *  - anthropic-ratelimit-tokens-remaining
 *  - anthropic-ratelimit-tokens-reset        (ISO 8601)
 *  - anthropic-ratelimit-requests-limit
 *  - anthropic-ratelimit-requests-remaining
 *  - anthropic-ratelimit-requests-reset       (ISO 8601)
 *  - retry-after                              (seconds)
 */
export const parseAnthropicRateLimitHeaders = (headers: Record<string, string>): RateLimitInfo => {
  const get = (key: string) => headers[key] ?? headers[key.toLowerCase()];

  return {
    provider: "anthropic",
    tokensLimit: safeParseInt(get("anthropic-ratelimit-tokens-limit")),
    tokensRemaining: safeParseInt(get("anthropic-ratelimit-tokens-remaining")),
    tokensReset: safeParseDate(get("anthropic-ratelimit-tokens-reset")),
    requestsLimit: safeParseInt(get("anthropic-ratelimit-requests-limit")),
    requestsRemaining: safeParseInt(get("anthropic-ratelimit-requests-remaining")),
    requestsReset: safeParseDate(get("anthropic-ratelimit-requests-reset")),
    retryAfterSeconds: parseRetryAfterSeconds(get("retry-after")),
    capturedAt: new Date(),
  };
};

// ---------------------------------------------------------------------------
// OpenAI header parser
// ---------------------------------------------------------------------------

/**
 * Parse OpenAI rate limit headers.
 *
 * Headers reference (https://platform.openai.com/docs/guides/rate-limits):
 *  - x-ratelimit-limit-tokens
 *  - x-ratelimit-remaining-tokens
 *  - x-ratelimit-reset-tokens             (duration like "6m0s")
 *  - x-ratelimit-limit-requests
 *  - x-ratelimit-remaining-requests
 *  - x-ratelimit-reset-requests           (duration like "6m0s")
 *  - retry-after                           (seconds)
 */
export const parseOpenAIRateLimitHeaders = (headers: Record<string, string>): RateLimitInfo => {
  const get = (key: string) => headers[key] ?? headers[key.toLowerCase()];

  return {
    provider: "openai",
    tokensLimit: safeParseInt(get("x-ratelimit-limit-tokens")),
    tokensRemaining: safeParseInt(get("x-ratelimit-remaining-tokens")),
    tokensReset: parseDurationToDate(get("x-ratelimit-reset-tokens")),
    requestsLimit: safeParseInt(get("x-ratelimit-limit-requests")),
    requestsRemaining: safeParseInt(get("x-ratelimit-remaining-requests")),
    requestsReset: parseDurationToDate(get("x-ratelimit-reset-requests")),
    retryAfterSeconds: parseRetryAfterSeconds(get("retry-after")),
    capturedAt: new Date(),
  };
};

// ---------------------------------------------------------------------------
// Generic dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch to the correct provider-specific parser based on provider name.
 * Returns null for unknown providers.
 */
export const parseRateLimitHeaders = (
  provider: string,
  headers: Record<string, string>,
): RateLimitInfo | null => {
  switch (provider) {
    case "anthropic":
      return parseAnthropicRateLimitHeaders(headers);
    case "openai":
      return parseOpenAIRateLimitHeaders(headers);
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// retry-after utilities
// ---------------------------------------------------------------------------

/**
 * Parse a retry-after value from an error message, header, or numeric field.
 *
 * Accepts:
 *  - A number (returned as-is if finite)
 *  - A numeric string ("30" -> 30)
 *  - null/undefined (returns null)
 */
export const parseRetryAfterSeconds = (value: string | number | null | undefined): number | undefined => {
  if (value == null) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Try to extract a retry-after value from an error message string.
 *
 * Common patterns:
 *  - "Please retry after X seconds"
 *  - "retry_after: X"
 *  - "Retry-After: X"
 *  - "rate limit ... try again in Xs"
 */
export const extractRetryAfterFromErrorMessage = (message: string): number | undefined => {
  if (!message) return undefined;

  // Pattern: "retry after X seconds" / "retry after Xs"
  const retryAfterMatch = message.match(/retry\s+after\s+(\d+(?:\.\d+)?)\s*s/i);
  if (retryAfterMatch) return parseFloat(retryAfterMatch[1]);

  // Pattern: "try again in X seconds" / "try again in Xs"
  const tryAgainMatch = message.match(/try\s+again\s+in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (tryAgainMatch) return parseFloat(tryAgainMatch[1]);

  // Pattern: "retry_after: X" or "Retry-After: X"
  const headerMatch = message.match(/retry[_-]after:\s*(\d+(?:\.\d+)?)/i);
  if (headerMatch) return parseFloat(headerMatch[1]);

  return undefined;
};

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Convert a RateLimitInfo to its serializable form (Dates -> ISO strings). */
export const serializeRateLimitInfo = (info: RateLimitInfo): RateLimitInfoSerialized => ({
  provider: info.provider,
  ...(info.tokensLimit != null && { tokensLimit: info.tokensLimit }),
  ...(info.tokensRemaining != null && { tokensRemaining: info.tokensRemaining }),
  ...(info.tokensReset != null && { tokensReset: info.tokensReset.toISOString() }),
  ...(info.requestsLimit != null && { requestsLimit: info.requestsLimit }),
  ...(info.requestsRemaining != null && { requestsRemaining: info.requestsRemaining }),
  ...(info.requestsReset != null && { requestsReset: info.requestsReset.toISOString() }),
  ...(info.retryAfterSeconds != null && { retryAfterSeconds: info.retryAfterSeconds }),
  capturedAt: info.capturedAt.toISOString(),
});
