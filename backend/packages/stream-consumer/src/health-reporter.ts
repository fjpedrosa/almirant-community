import type Redis from "ioredis";
import type { StreamConsumerMetrics } from "./types";

// ---------------------------------------------------------------------------
// HealthReporter — collects metrics from Redis and internal counters
// ---------------------------------------------------------------------------

export type HealthReporter = {
  getMetrics: () => Promise<StreamConsumerMetrics>;
  getHealthStatus: () => Promise<StreamConsumerMetrics["status"]>;
  recordProcessed: () => void;
  recordFailed: () => void;
  recordRetried: () => void;
  recordDlq: () => void;
};

const RATE_WINDOW_MS = 60_000; // 60-second rolling window
const PENDING_HEALTHY_THRESHOLD = 100;
const LAG_HEALTHY_THRESHOLD = 5_000;

export const createHealthReporter = (
  redis: Redis,
  streamName: string,
  consumerGroup: string
): HealthReporter => {
  let totalProcessed = 0;
  let totalFailed = 0;
  let totalRetried = 0;
  let totalDlq = 0;
  let lastProcessedAt: string | null = null;

  // Rolling window for processing rate
  const processedTimestamps: number[] = [];

  const pruneTimestamps = (now: number): void => {
    const cutoff = now - RATE_WINDOW_MS;
    while (processedTimestamps.length > 0) {
      const firstTimestamp = processedTimestamps[0];
      if (firstTimestamp === undefined || firstTimestamp >= cutoff) {
        break;
      }
      processedTimestamps.shift();
    }
  };

  const recordProcessed = (): void => {
    totalProcessed++;
    const now = Date.now();
    lastProcessedAt = new Date(now).toISOString();
    processedTimestamps.push(now);
  };

  const recordFailed = (): void => {
    totalFailed++;
  };

  const recordRetried = (): void => {
    totalRetried++;
  };

  const recordDlq = (): void => {
    totalDlq++;
  };

  const getMetrics = async (): Promise<StreamConsumerMetrics> => {
    const now = Date.now();
    pruneTimestamps(now);

    // Processing rate: events per second over the rolling window
    const processingRate =
      processedTimestamps.length > 0
        ? processedTimestamps.length / (RATE_WINDOW_MS / 1000)
        : 0;

    // Fetch pending info from Redis
    let pendingCount = 0;
    let oldestPendingMs = 0;

    try {
      // XPENDING returns: [totalPending, smallestId, largestId, [[consumer, count], ...]]
      const pendingInfo = await redis.xpending(streamName, consumerGroup);
      if (Array.isArray(pendingInfo) && pendingInfo.length >= 4) {
        pendingCount = Number(pendingInfo[0]) || 0;

        // Extract oldest pending timestamp from the smallest ID (format: timestamp-seq)
        if (pendingInfo[1] && typeof pendingInfo[1] === "string") {
          const [oldestPendingId] = pendingInfo[1].split("-");
          const oldestTimestamp = oldestPendingId
            ? parseInt(oldestPendingId, 10)
            : Number.NaN;
          if (!isNaN(oldestTimestamp)) {
            oldestPendingMs = now - oldestTimestamp;
          }
        }
      }
    } catch {
      // Group may not exist yet
    }

    // Stream lag: total entries in stream
    let streamLag = 0;
    try {
      const streamLen = await redis.xlen(streamName);
      streamLag = streamLen;
    } catch {
      // Stream may not exist yet
    }

    // Determine health status
    const status = determineStatus(pendingCount, streamLag, lastProcessedAt, now);

    return {
      totalProcessed,
      totalFailed,
      totalRetried,
      totalDlq,
      processingRate,
      lastProcessedAt,
      pendingCount,
      streamLag,
      oldestPendingMs,
      status,
    };
  };

  const getHealthStatus = async (): Promise<StreamConsumerMetrics["status"]> => {
    const metrics = await getMetrics();
    return metrics.status;
  };

  return {
    getMetrics,
    getHealthStatus,
    recordProcessed,
    recordFailed,
    recordRetried,
    recordDlq,
  };
};

const determineStatus = (
  pendingCount: number,
  lag: number,
  lastProcessedAt: string | null,
  now: number
): StreamConsumerMetrics["status"] => {
  // Unhealthy: no processing activity for over 60 seconds (stale)
  if (lastProcessedAt) {
    const lastTs = new Date(lastProcessedAt).getTime();
    if (now - lastTs > 60_000 && pendingCount > 0) {
      return "unhealthy";
    }
  }

  // Healthy: low pending count and lag
  if (pendingCount < PENDING_HEALTHY_THRESHOLD && lag < LAG_HEALTHY_THRESHOLD) {
    return "healthy";
  }

  // Degraded: processing but elevated pending/lag
  return "degraded";
};
