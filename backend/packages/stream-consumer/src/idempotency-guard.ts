import type Redis from "ioredis";

// ---------------------------------------------------------------------------
// IdempotencyGuard — prevents duplicate processing via Redis SET NX EX
// ---------------------------------------------------------------------------

export type IdempotencyGuard = {
  isProcessed: (consumerGroup: string, eventId: string) => Promise<boolean>;
  markProcessed: (
    consumerGroup: string,
    eventId: string,
    ttlSeconds?: number
  ) => Promise<void>;
};

const DEFAULT_TTL_SECONDS = 86_400; // 24 hours
const KEY_PREFIX = "agent-output:processed";

const buildKey = (consumerGroup: string, eventId: string): string =>
  `${KEY_PREFIX}:${consumerGroup}:${eventId}`;

export const createIdempotencyGuard = (redis: Redis): IdempotencyGuard => {
  const isProcessed = async (
    consumerGroup: string,
    eventId: string
  ): Promise<boolean> => {
    const result = await redis.get(buildKey(consumerGroup, eventId));
    return result !== null;
  };

  const markProcessed = async (
    consumerGroup: string,
    eventId: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<void> => {
    await redis.set(buildKey(consumerGroup, eventId), "1", "EX", ttlSeconds, "NX");
  };

  return { isProcessed, markProcessed };
};
