import { Elysia } from "elysia";
import { createAlmirantWorkerClient } from "@almirant/remote-agent";
import { createContainerManager } from "./workspace/container-manager";
import { loadRunnerEnv } from "./shared/config";
import { createJobExecutor } from "./job-executor";
import { createRunnerOrchestrator } from "./orchestration/orchestrator";
import { createPlatformInjector } from "./workspace/platform-injector";
import { initTelemetry, shutdownTelemetry } from "./observability/telemetry";
import { createRuntimeExecutorRegistry } from "./runtime-executors/registry";

const env = loadRunnerEnv();

// Initialize Sentry + PostHog telemetry (no-op if env vars not set)
initTelemetry({
  sentryDsn: env.SENTRY_DSN,
  posthogApiKey: env.POSTHOG_API_KEY,
  posthogHost: env.POSTHOG_HOST,
  environment: env.NODE_ENV,
  workerId: env.WORKER_ID,
  hostname: env.RUNNER_HOSTNAME,
});
const isBridgeMode = env.BRIDGE_MODE === "true";

const workerClient = createAlmirantWorkerClient({
  apiBaseUrl: env.ALMIRANT_API_URL,
  apiKey: env.ALMIRANT_API_KEY,
});

const containerManager = createContainerManager({
  dockerSocketPath: env.DOCKER_SOCKET,
  workerId: env.WORKER_ID,
  // Use direct socket for archive/exec ops that fail through the Docker socket proxy
  directSocketPath: env.DOCKER_SOCKET !== "/var/run/docker.sock"
    ? "/var/run/docker.sock"
    : undefined,
  ...(env.GHCR_USERNAME && env.GHCR_TOKEN
    ? {
        registryAuth: {
          username: env.GHCR_USERNAME,
          password: env.GHCR_TOKEN,
          serveraddress: "ghcr.io",
        },
      }
    : {}),
});

const platformInjector = createPlatformInjector({
  platformConfigPath: env.PLATFORM_CONFIG_PATH,
});

const runtimeExecutorRegistry = createRuntimeExecutorRegistry();

const jobExecutor = createJobExecutor(
  {
    workerId: env.WORKER_ID,
    opencodeImage: env.OPENCODE_IMAGE,
    claudeShimImage: env.CLAUDE_SHIM_IMAGE,
    codexShimImage: env.CODEX_SHIM_IMAGE,
    opencodeCommand: env.OPENCODE_COMMAND,
    repositoryPath: "/app/repos",
    reposHostPath: env.REPOS_HOST_PATH,
    apiBaseUrl: env.ALMIRANT_API_URL,
    apiKey: env.ALMIRANT_API_KEY,
    redis: env.REDIS_URL
      ? {
          url: env.REDIS_URL,
          queueName: env.QUEUE_NAME,
        }
      : undefined,
    discord: env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID
      ? {
          botToken: env.DISCORD_BOT_TOKEN,
          channelId: env.DISCORD_CHANNEL_ID,
        }
      : undefined,
    checkpoint: env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
      ? {
          s3: {
            accessKey: env.S3_ACCESS_KEY,
            secretKey: env.S3_SECRET_KEY,
            region: env.S3_REGION,
            bucket: env.S3_BUCKET,
            endpoint: env.S3_ENDPOINT,
          },
          intervalMs: env.CHECKPOINT_INTERVAL_MS,
        }
      : undefined,
    overallTimeoutMs: env.JOB_OVERALL_TIMEOUT_MS,
    effortPointDurationMs: env.EFFORT_POINT_DURATION_MS,
    preSessionTimeoutMs: env.JOB_PRE_SESSION_TIMEOUT_MS,
    webOutputEnabled: env.WEB_OUTPUT_ENABLED === "true",
    platformConfigPath: env.PLATFORM_CONFIG_PATH,
  },
  {
    workerClient,
    containerManager,
    platformInjector,
    runtimeExecutorRegistry,
  }
);

const orchestrator = createRunnerOrchestrator(
  {
    workerId: env.WORKER_ID,
    hostname: env.RUNNER_HOSTNAME,
    maxConcurrent: env.MAX_CONCURRENT,
    heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
    claimIntervalMs: env.CLAIM_INTERVAL_MS,
    nightlyCheckIntervalMs: env.NIGHTLY_CHECK_INTERVAL_MS,
    ramBudgetEnabled: env.RUNNER_RAM_BUDGET_ENABLED === "true",
    ramReservedMb: env.RUNNER_RAM_RESERVED_MB,
    apiUrl: env.ALMIRANT_API_URL,
    apiKey: env.ALMIRANT_API_KEY,
    maxAutoRetries: env.MAX_AUTO_RETRIES,
    retryBackoffMs: env.RETRY_BACKOFF_MS,
    repositoryPath: "/app/repos",
  },
  {
    workerClient,
    containerManager,
    jobExecutor,
  }
);

const app = new Elysia()
  .get("/health", async () => {
    const dockerHealthy = isBridgeMode ? true : await containerManager.ping();
    const snapshot = orchestrator.getSnapshot();

    return {
      ok: dockerHealthy,
      docker: dockerHealthy,
      runner: snapshot,
      bridge: isBridgeMode,
      uptimeSeconds: Math.round(process.uptime()),
    };
  })
  .get("/status", () => {
    return {
      ok: true,
      runner: orchestrator.getSnapshot(),
      bridge: isBridgeMode,
    };
  })
  .post("/drain", () => {
    if (orchestrator.isDraining) {
      return { ok: true, message: "already draining" };
    }
    // Don't await — respond immediately, drain runs in background
    void orchestrator.drain().then(() => {
      console.log("drain complete via HTTP endpoint");
    });
    return { ok: true, message: "drain initiated" };
  });

const server = app.listen(env.PORT);

if (isBridgeMode) {
  console.log(
    `almirant-discord-bridge listening on port ${env.PORT} (bridge mode — orchestrator disabled)`
  );
} else {
  console.log(
    `almirant-runner listening on port ${env.PORT} (workerId=${env.WORKER_ID})`
  );
  void orchestrator.start();
}

const shutdown = async (signal: string) => {
  console.log(`received ${signal}, shutting down runner...`);
  await orchestrator.stop();
  await shutdownTelemetry();
  server.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
