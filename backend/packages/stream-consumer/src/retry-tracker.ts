import type { RetryConfig } from "./types";

// ---------------------------------------------------------------------------
// RetryTracker — pure in-memory tracker for retry scheduling with
// exponential backoff and jitter
// ---------------------------------------------------------------------------

type RetryEntry = {
  retryCount: number;
  nextRetryAt: number;
};

export type RetryTracker = {
  recordFailure: (eventId: string) => void;
  shouldRetry: (eventId: string) => boolean;
  getRetryableEventIds: (now: number) => string[];
  remove: (eventId: string) => void;
  getRetryCount: (eventId: string) => number;
};

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_MAX_DELAY_MS = 30_000;

export const createRetryTracker = (config?: RetryConfig): RetryTracker => {
  const maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = config?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  const entries = new Map<string, RetryEntry>();

  const recordFailure = (eventId: string): void => {
    const existing = entries.get(eventId);
    const retryCount = existing ? existing.retryCount + 1 : 1;

    // Exponential backoff: baseDelay * 2^retryCount, capped at maxDelay
    const rawDelay = Math.min(baseDelayMs * Math.pow(2, retryCount), maxDelayMs);

    // Jitter: random 0-50% of calculated delay
    const jitter = rawDelay * Math.random() * 0.5;
    const delay = rawDelay + jitter;

    entries.set(eventId, {
      retryCount,
      nextRetryAt: Date.now() + delay,
    });
  };

  const shouldRetry = (eventId: string): boolean => {
    const entry = entries.get(eventId);
    if (!entry) return true; // Never failed = can retry
    return entry.retryCount < maxRetries;
  };

  const getRetryableEventIds = (now: number): string[] => {
    const result: string[] = [];
    for (const [eventId, entry] of entries) {
      if (entry.nextRetryAt <= now && entry.retryCount < maxRetries) {
        result.push(eventId);
      }
    }
    return result;
  };

  const remove = (eventId: string): void => {
    entries.delete(eventId);
  };

  const getRetryCount = (eventId: string): number => {
    const entry = entries.get(eventId);
    return entry ? entry.retryCount : 0;
  };

  return {
    recordFailure,
    shouldRetry,
    getRetryableEventIds,
    remove,
    getRetryCount,
  };
};
