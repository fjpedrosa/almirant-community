export const DEFAULT_QUOTA_PAUSE_RETRY_MS = 5 * 60 * 1000; // 5 minutes

export type QuotaPauseRequest = {
  reason: string;
  errorType: "subscription_limit" | "rate_limit" | "provider_quota_exceeded";
  retryDelayMs: number;
  availableAt: string;
  sourceEventType?: string;
};

const RELATIVE_RESET_RE = /resets?\s+in\s+(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i;
const ABSOLUTE_RESET_RE = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)/i;

const coercePositiveDelay = (delayMs: number | undefined): number | undefined =>
  typeof delayMs === "number" && Number.isFinite(delayMs) && delayMs > 0
    ? delayMs
    : undefined;

export const parseQuotaResetDelayMs = (
  text: string,
  now: Date = new Date(),
): number | undefined => {
  const relMatch = text.match(RELATIVE_RESET_RE);
  if (relMatch) {
    const hours = relMatch[1] ? Number.parseInt(relMatch[1], 10) : 0;
    const minutes = relMatch[2] ? Number.parseInt(relMatch[2], 10) : 0;
    const delayMs = ((Number.isNaN(hours) ? 0 : hours) * 60 + (Number.isNaN(minutes) ? 0 : minutes)) * 60 * 1000;
    return coercePositiveDelay(delayMs);
  }

  const absMatch = text.match(ABSOLUTE_RESET_RE);
  if (absMatch?.[1] && absMatch[3]) {
    let hour = Number.parseInt(absMatch[1], 10);
    const minute = absMatch[2] ? Number.parseInt(absMatch[2], 10) : 0;
    const meridiem = absMatch[3].toLowerCase();

    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;

      const resetTime = new Date(now);
      resetTime.setUTCHours(hour, minute, 0, 0);
      if (resetTime.getTime() <= now.getTime()) {
        resetTime.setUTCDate(resetTime.getUTCDate() + 1);
      }
      return coercePositiveDelay(resetTime.getTime() - now.getTime());
    }
  }

  return undefined;
};

export const resolveQuotaAvailableAt = (
  resetAt?: string | null,
  fallbackDelayMs = DEFAULT_QUOTA_PAUSE_RETRY_MS,
  now: Date = new Date(),
): string => {
  if (resetAt) {
    const parsed = new Date(resetAt);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) {
      return parsed.toISOString();
    }
  }

  return new Date(now.getTime() + fallbackDelayMs).toISOString();
};

const buildRequest = (
  reason: string,
  errorType: QuotaPauseRequest["errorType"],
  retryDelayMs: number,
  now: Date,
): QuotaPauseRequest => ({
  reason,
  errorType,
  retryDelayMs,
  availableAt: new Date(now.getTime() + retryDelayMs).toISOString(),
});

export const detectQuotaPauseFromText = (
  text: string,
  now: Date = new Date(),
): QuotaPauseRequest | null => {
  if (!text.trim()) return null;

  const resetDelayMs = parseQuotaResetDelayMs(text, now);

  if (/you['’]?ve hit your limit/i.test(text)) {
    return buildRequest(
      "Session hit subscription rate limit",
      "subscription_limit",
      resetDelayMs ?? DEFAULT_QUOTA_PAUSE_RETRY_MS,
      now,
    );
  }

  if (/\b429\b/.test(text) && /too many requests|rate limit/i.test(text)) {
    return buildRequest(
      "Session hit API rate limit",
      "rate_limit",
      resetDelayMs ?? DEFAULT_QUOTA_PAUSE_RETRY_MS,
      now,
    );
  }

  if (/quota exceeded|usage limit|weekly\s+limit|session\s+limit|limit reached/i.test(text)) {
    return buildRequest(
      "Provider quota exhausted",
      "provider_quota_exceeded",
      resetDelayMs ?? DEFAULT_QUOTA_PAUSE_RETRY_MS,
      now,
    );
  }

  return null;
};
