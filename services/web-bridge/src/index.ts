import { Elysia } from "elysia";
import { loadBridgeEnv } from "./config";
import { createWebBridgeConsumer } from "./consumer";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const env = loadBridgeEnv();

// ---------------------------------------------------------------------------
// Simple structured logger
// ---------------------------------------------------------------------------

const LOG_LEVELS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const currentLogLevel = LOG_LEVELS[env.LOG_LEVEL] ?? 30;

const log = (
  level: string,
  message: string,
  meta?: Record<string, unknown>
): void => {
  const numericLevel = LOG_LEVELS[level] ?? 30;
  if (numericLevel < currentLogLevel) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: "web-bridge",
    message,
    ...meta,
  };

  if (numericLevel >= 50) {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
};

// ---------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------

const consumer = createWebBridgeConsumer({
  env,
  redisConnectionString: env.REDIS_URL,
  log,
});

consumer.start();

// ---------------------------------------------------------------------------
// Health / stats HTTP server (Elysia)
// ---------------------------------------------------------------------------

const app = new Elysia()
  .get("/health", () => {
    return {
      ok: true,
      service: "web-bridge",
      stream: env.STREAM_NAME,
      consumerGroup: env.CONSUMER_GROUP,
      pubsubChannel: env.PUBSUB_CHANNEL,
      stats: consumer.getStats(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  })
  .get("/stats", () => {
    return consumer.getStats();
  });

const server = app.listen(env.PORT);

log("info", `web-bridge listening on port ${env.PORT}`, {
  stream: env.STREAM_NAME,
  consumerGroup: env.CONSUMER_GROUP,
  pubsubChannel: env.PUBSUB_CHANNEL,
  coalesceIdleMs: env.COALESCE_IDLE_MS,
  coalesceMaxWaitMs: env.COALESCE_MAX_WAIT_MS,
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

const shutdown = async (signal: string): Promise<void> => {
  log("info", `Received ${signal}, shutting down web-bridge...`);
  await consumer.stop();
  server.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
