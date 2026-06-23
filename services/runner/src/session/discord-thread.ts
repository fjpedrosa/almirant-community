// ---------------------------------------------------------------------------
// Discord thread creation with retry logic
//
// Extracted from job-executor.ts — retryable error detection and exponential
// backoff for Discord thread creation.
// ---------------------------------------------------------------------------

import type { createDiscordChannelAdapter } from "@almirant/remote-agent";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const DISCORD_THREAD_CREATE_MAX_ATTEMPTS = 4;
export const DISCORD_THREAD_CREATE_RETRY_BASE_MS = 1_500;

export const isRetryableDiscordThreadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /Discord API error (429|5\d\d)\b/.test(message) ||
    /upstream connect error|disconnect\/reset before headers|fetch failed|aborted|timeout/i.test(message);
};

export const createDiscordThreadWithRetry = async (params: {
  adapter: ReturnType<typeof createDiscordChannelAdapter>;
  channelId: string;
  name: string;
  jobId: string;
}): Promise<{ id: string }> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DISCORD_THREAD_CREATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const thread = await params.adapter.createThread({
        channelId: params.channelId,
        name: params.name,
      });
      return { id: thread.id };
    } catch (error) {
      lastError = error;
      if (attempt >= DISCORD_THREAD_CREATE_MAX_ATTEMPTS || !isRetryableDiscordThreadError(error)) {
        throw error;
      }

      const waitMs = DISCORD_THREAD_CREATE_RETRY_BASE_MS * attempt;
      console.warn(
        `[job:${params.jobId}] Discord thread creation failed (attempt ${attempt}/${DISCORD_THREAD_CREATE_MAX_ATTEMPTS}): ${
          error instanceof Error ? error.message : String(error)
        }. Retrying in ${waitMs}ms`
      );
      await sleep(waitMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};
