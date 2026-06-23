import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3004),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  REDIS_URL: z.string().url(),
  STREAM_NAME: z.string().default("agent-output"),
  CONSUMER_GROUP: z.string().default("web-bridge"),
  CONSUMER_ID: z.string().default(`web-bridge-${process.pid}`),
  BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(10),
  COALESCE_IDLE_MS: z.coerce.number().int().min(50).max(5000).default(100),
  COALESCE_MAX_WAIT_MS: z.coerce.number().int().min(100).max(30000).default(500),
  /** Redis Pub/Sub channel used to broadcast events to the backend WS layer. */
  PUBSUB_CHANNEL: z.string().default("ws:broadcast"),
  /** Backend API URL for DB operations (interactions, job status, text persistence). */
  BACKEND_API_URL: z.string().url().optional(),
  /** API key for authenticating with the backend. */
  BRIDGE_API_KEY: z.string().optional(),
});

export type BridgeEnv = z.infer<typeof envSchema>;

export const loadBridgeEnv = (
  source: Record<string, string | undefined> = process.env
): BridgeEnv => {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(
      `Invalid web-bridge environment: ${JSON.stringify(details)}`
    );
  }

  return parsed.data;
};
