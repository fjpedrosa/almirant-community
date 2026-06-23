// ---------------------------------------------------------------------------
// Shared retry helper with exponential backoff
//
// Handles Discord API rate limits (429) and transient errors (502/503/504).
// Single source of truth — replaces duplicated implementations in consumer
// and renderer.
// ---------------------------------------------------------------------------

export type RetryOpts = {
  maxRetries: number;
  baseDelayMs: number;
  label: string;
};

export const withRetry = async <T>(
  fn: () => Promise<T>,
  opts: RetryOpts,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isRateLimit =
        error instanceof Error && error.message.includes("429");
      const isTransient =
        error instanceof Error &&
        (error.message.includes("502") ||
          error.message.includes("503") ||
          error.message.includes("504"));

      if (attempt < opts.maxRetries && (isRateLimit || isTransient)) {
        const delayMs = opts.baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      break;
    }
  }
  throw lastError;
};
