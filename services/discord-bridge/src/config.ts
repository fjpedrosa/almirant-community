import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3003),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  REDIS_URL: z.string().url(),
  STREAM_NAME: z.string().default("agent-output"),
  CONSUMER_GROUP: z.string().default("discord-bridge"),
  CONSUMER_ID: z.string().default(`discord-bridge-${process.pid}`),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_CHANNEL_ID: z.string().min(1),
  BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  /** Maximum retries for Discord API rate-limit / transient errors. */
  MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  /** Base delay in ms for exponential backoff. */
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(30000).default(1000),
  /** Which content types to forward to Discord. */
  DISCORD_CONTENT_FILTER: z.enum(["all", "text", "thinking", "text,thinking"]).default("all"),
  /** Backend API base URL for event persistence. */
  BACKEND_API_URL: z.string().url().optional(),
  /** API key for authenticating with the backend. */
  BRIDGE_API_KEY: z.string().min(1).optional(),
});

export type BridgeEnv = z.infer<typeof envSchema>;

export const loadBridgeEnv = (
  source: Record<string, string | undefined> = process.env
): BridgeEnv => {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(
      `Invalid discord-bridge environment: ${JSON.stringify(details)}`
    );
  }

  return parsed.data;
};
