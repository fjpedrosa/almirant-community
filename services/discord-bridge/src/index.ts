// ---------------------------------------------------------------------------
// Discord Bridge — Composition Root
//
// Wires all dependencies together and starts the service.
// No business logic here — only dependency creation and lifecycle management.
// ---------------------------------------------------------------------------

import { createDiscordChannelAdapter } from "@almirant/remote-agent";
import { loadBridgeEnv } from "./config";
import { createLogger } from "./platform/logger";
import { createDiscordRenderer } from "./rendering/renderer";
import { createApiClient } from "./job-persistence/api-client";
import { createDiscordBridgeConsumer } from "./event-processing/consumer";
import { createHttpServer } from "./platform/http-server";

// ---------------------------------------------------------------------------
// Environment & Logger
// ---------------------------------------------------------------------------

const env = loadBridgeEnv();
const log = createLogger(env.LOG_LEVEL);

// ---------------------------------------------------------------------------
// Discord adapter
// ---------------------------------------------------------------------------

const discordAdapter = createDiscordChannelAdapter({
  botToken: env.DISCORD_BOT_TOKEN,
});

// ---------------------------------------------------------------------------
// Discord renderer (canonical event -> Discord API)
// ---------------------------------------------------------------------------

const renderer = createDiscordRenderer({
  adapter: discordAdapter,
  contentFilter: env.DISCORD_CONTENT_FILTER,
  log,
  retryOpts: {
    maxRetries: env.MAX_RETRIES,
    baseDelayMs: env.RETRY_BASE_DELAY_MS,
  },
});

// ---------------------------------------------------------------------------
// API client (optional — for DB persistence)
// ---------------------------------------------------------------------------

const apiClient =
  env.BACKEND_API_URL && env.BRIDGE_API_KEY
    ? createApiClient({
        baseUrl: env.BACKEND_API_URL,
        apiKey: env.BRIDGE_API_KEY,
        log,
      })
    : null;

if (apiClient) {
  log("info", "API client initialized for canonical event processing", {
    baseUrl: env.BACKEND_API_URL,
  });
}

// ---------------------------------------------------------------------------
// Thread name registry (shared between HTTP server and consumer)
// ---------------------------------------------------------------------------

const threadNameRegistry = new Map<string, string>();

// ---------------------------------------------------------------------------
// Consumer (StreamReader + canonical router)
// ---------------------------------------------------------------------------

const consumer = createDiscordBridgeConsumer({
  renderer,
  discordAdapter,
  env,
  redisConnectionString: env.REDIS_URL,
  log,
  apiClient,
  threadNameRegistry,
});

consumer.start();

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const app = createHttpServer({
  env,
  discordAdapter,
  log,
  threadNameRegistry,
  getStats: consumer.getStats,
});

const server = app.listen(env.PORT);

log("info", `discord-bridge listening on port ${env.PORT}`, {
  stream: env.STREAM_NAME,
  consumerGroup: env.CONSUMER_GROUP,
  channelId: env.DISCORD_CHANNEL_ID,
  canonicalOnly: true,
  apiEnabled: !!apiClient,
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const shutdown = async (signal: string): Promise<void> => {
  log("info", `Received ${signal}, shutting down discord-bridge...`);
  await consumer.stop();
  server.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
