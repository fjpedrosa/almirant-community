import type Redis from "ioredis";
import { DEFAULT_STREAM_NAME } from "./types";

// ---------------------------------------------------------------------------
// StreamCleaner — trims only entries safe for every consumer group
// ---------------------------------------------------------------------------

export type StreamCleanerConfig = {
  streamName?: string;
  /** @deprecated DLQ retention is deliberately managed separately. */
  dlqStreamName?: string;
  /** @deprecated Safety is based on consumer-group progress, not wall time. */
  retentionMs?: number;
  intervalMs?: number; // default: 3600000 (1h)
  /** @deprecated Length alone cannot prove that a DLQ entry is safe to trim. */
  dlqMaxLen?: number; // default: 10000
};

export type StreamCleaner = {
  cleanNow: () => Promise<number>;
  start: () => void;
  stop: () => void;
};

type GroupInfo = {
  name: string;
  pending: number;
  lastDeliveredId: string;
};

const readGroupField = (
  group: unknown[],
  fieldName: string,
): unknown => {
  for (let index = 0; index < group.length - 1; index += 2) {
    if (group[index] === fieldName) return group[index + 1];
  }
  return undefined;
};

const parseGroup = (value: unknown): GroupInfo | null => {
  if (!Array.isArray(value)) return null;

  const name = readGroupField(value, "name");
  const pending = Number(readGroupField(value, "pending"));
  const lastDeliveredId = readGroupField(value, "last-delivered-id");
  if (
    typeof name !== "string"
    || !Number.isSafeInteger(pending)
    || pending < 0
    || typeof lastDeliveredId !== "string"
  ) {
    return null;
  }

  return { name, pending, lastDeliveredId };
};

const parseStreamId = (id: string): [bigint, bigint] | null => {
  const match = /^(\d+)-(\d+)$/.exec(id);
  if (!match?.[1] || !match[2]) return null;
  return [BigInt(match[1]), BigInt(match[2])];
};

const earlierStreamId = (left: string, right: string): string | null => {
  const parsedLeft = parseStreamId(left);
  const parsedRight = parseStreamId(right);
  if (!parsedLeft || !parsedRight) return null;

  if (parsedLeft[0] !== parsedRight[0]) {
    return parsedLeft[0] < parsedRight[0] ? left : right;
  }
  return parsedLeft[1] <= parsedRight[1] ? left : right;
};

export const createStreamCleaner = (
  redis: Redis,
  config: StreamCleanerConfig = {},
): StreamCleaner => {
  const streamName = config.streamName ?? DEFAULT_STREAM_NAME;
  const intervalMs = config.intervalMs ?? 3_600_000;
  let interval: ReturnType<typeof setInterval> | null = null;
  let activeCleanup: Promise<number> | null = null;

  const computeSafeFrontier = async (): Promise<string | null> => {
    const rawGroups = await redis.xinfo("GROUPS", streamName);
    if (!Array.isArray(rawGroups) || rawGroups.length === 0) return null;

    let globalFrontier: string | null = null;
    for (const rawGroup of rawGroups) {
      const group = parseGroup(rawGroup);
      if (!group) return null;

      let groupFrontier = group.lastDeliveredId;
      if (group.pending > 0) {
        const pendingEntries = await redis.xpending(
          streamName,
          group.name,
          "-",
          "+",
          1,
        );
        const oldestPending = Array.isArray(pendingEntries)
          && Array.isArray(pendingEntries[0])
          ? pendingEntries[0][0]
          : undefined;
        if (typeof oldestPending !== "string") return null;
        groupFrontier = oldestPending;
      }

      if (!parseStreamId(groupFrontier)) return null;
      if (globalFrontier === null) {
        globalFrontier = groupFrontier;
        continue;
      }

      globalFrontier = earlierStreamId(globalFrontier, groupFrontier);
      if (globalFrontier === null) return null;
    }

    return globalFrontier;
  };

  const runCleanup = async (): Promise<number> => {
    const frontier = await computeSafeFrontier();
    if (!frontier || frontier === "0-0") return 0;
    return redis.xtrim(streamName, "MINID", "=", frontier);
  };

  const cleanNow = (): Promise<number> => {
    if (activeCleanup) return activeCleanup;
    activeCleanup = runCleanup().finally(() => {
      activeCleanup = null;
    });
    return activeCleanup;
  };

  const start = (): void => {
    if (interval) return;
    void cleanNow().catch(() => undefined);
    interval = setInterval(() => {
      void cleanNow().catch(() => undefined);
    }, intervalMs);
  };

  const stop = (): void => {
    if (!interval) return;
    clearInterval(interval);
    interval = null;
  };

  return { cleanNow, start, stop };
};
