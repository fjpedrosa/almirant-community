import type Redis from "ioredis";
import { DEFAULT_STREAM_NAME, DEFAULT_DLQ_STREAM_NAME } from "./types";

// ---------------------------------------------------------------------------
// StreamCleaner — periodic XTRIM on main stream and DLQ
// ---------------------------------------------------------------------------

export type StreamCleanerConfig = {
  streamName?: string;
  dlqStreamName?: string;
  retentionMs?: number; // default: 86400000 (24h)
  intervalMs?: number; // default: 3600000 (1h)
  dlqMaxLen?: number; // default: 10000
};

export type StreamCleaner = {
  start: () => void;
  stop: () => void;
};

const DEFAULT_RETENTION_MS = 86_400_000; // 24 hours
const DEFAULT_INTERVAL_MS = 3_600_000; // 1 hour
const DEFAULT_DLQ_MAX_LEN = 10_000;

export const createStreamCleaner = (
  redis: Redis,
  config?: StreamCleanerConfig
): StreamCleaner => {
  const streamName = config?.streamName ?? DEFAULT_STREAM_NAME;
  const dlqStreamName = config?.dlqStreamName ?? DEFAULT_DLQ_STREAM_NAME;
  const retentionMs = config?.retentionMs ?? DEFAULT_RETENTION_MS;
  const intervalMs = config?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const dlqMaxLen = config?.dlqMaxLen ?? DEFAULT_DLQ_MAX_LEN;

  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  const trim = async (): Promise<void> => {
    // Main stream: trim entries older than retentionMs
    const minId = Date.now() - retentionMs;
    await redis.xtrim(streamName, "MINID", "~", minId);

    // DLQ: trim by max length
    await redis.xtrim(dlqStreamName, "MAXLEN", "~", dlqMaxLen);
  };

  const start = (): void => {
    if (intervalHandle) return;
    // Run trim immediately, then on interval
    trim().catch(() => {
      /* swallow errors in background trim */
    });
    intervalHandle = setInterval(() => {
      trim().catch(() => {
        /* swallow errors in background trim */
      });
    }, intervalMs);
  };

  const stop = (): void => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };

  return { start, stop };
};
