const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 150;

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isRetryableCompleteAiTaskError = (error: unknown): boolean => {
  const message = toMessage(error);

  return (
    /Failed query:\s*update\s+"work_items"\s+set\s+"position"/i.test(message) ||
    /deadlock detected/i.test(message) ||
    /could not serialize access/i.test(message) ||
    /lock timeout/i.test(message) ||
    /due to concurrent update/i.test(message)
  );
};

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

export const runWithCompleteAiTaskRetry = async <T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    onRetry?: (error: unknown, attempt: number, nextDelayMs: number) => void;
  } = {},
): Promise<T> => {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry =
        attempt < maxAttempts && isRetryableCompleteAiTaskError(error);
      if (!shouldRetry) {
        throw error;
      }

      const nextDelayMs = baseDelayMs * attempt;
      options.onRetry?.(error, attempt, nextDelayMs);
      await sleep(nextDelayMs);
    }
  }

  throw new Error("complete_ai_task retry exhausted without returning");
};
