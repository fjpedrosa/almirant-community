export * from "./queue-adapter.js";
export * from "./pg-queue-adapter.js";
export * from "./bullmq-queue-adapter.js";

import type { QueueAdapter, QueueAdapterConfig } from "./queue-adapter.js";
import { createPgQueueAdapter } from "./pg-queue-adapter.js";
import { createBullMQQueueAdapter } from "./bullmq-queue-adapter.js";

const resolveRedisUrl = (config: QueueAdapterConfig): string | null => {
  const value =
    config.redisUrl ??
    // allow env-style config objects passed through from bootstrap code
    (config as unknown as { REDIS_URL?: unknown }).REDIS_URL ??
    process.env.REDIS_URL;

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

export const createQueueAdapter = (config: QueueAdapterConfig): QueueAdapter => {
  const redisUrl = resolveRedisUrl(config);

  if (redisUrl) {
    console.log(`mc-worker queue: using BullMQ adapter (REDIS_URL set)`);
    return createBullMQQueueAdapter({ ...config, redisUrl });
  }

  console.log("mc-worker queue: using PG adapter (default)");
  return createPgQueueAdapter(config);
};
