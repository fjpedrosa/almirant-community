import os from "node:os";
import { logger } from "@almirant/config";
import { loadConfig } from "./config.js";
import { ensureProviderKeysInEnv } from "./provider-keys.js";
import { createQueueAdapter } from "./queue/index.js";
import { createOrchestrator } from "./orchestrator.js";
import { startHeartbeat } from "./heartbeat.js";
import { cleanupOrphanedWorktrees } from "./orphaned-worktree-cleaner.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const startDaemon = async (): Promise<void> => {
  const config = await loadConfig();
  const providerKeys = await ensureProviderKeysInEnv(config).catch((err) => {
    logger.warn({ err }, "mc-worker: failed to resolve provider keys from backend");
    return { anthropicApiKey: config.anthropicApiKey, openaiApiKey: config.openaiApiKey };
  });

  const pollIntervalMs = Number(process.env.MC_POLL_INTERVAL_MS ?? "5000");
  const safePoll = Number.isFinite(pollIntervalMs) && pollIntervalMs >= 250 ? pollIntervalMs : 5_000;

  const queue = createQueueAdapter({
    apiBaseUrl: config.apiUrl,
    apiKey: config.apiKey,
    workerId: config.workerId,
    pollIntervalMs: safePoll,
    maxClaimCount: config.maxConcurrentAgents,
    redisUrl: config.redisUrl,
  });

  const orchestrator = createOrchestrator({
    workerId: config.workerId,
    maxConcurrentAgents: config.maxConcurrentAgents,
    queue,
    apiBaseUrl: config.apiUrl,
    apiKey: config.apiKey,
    providers: {
      claudeCode: { apiKey: providerKeys.anthropicApiKey },
      codex: { apiKey: providerKeys.openaiApiKey },
    },
    onProgress: (p) => {
      logger.info({ ...p }, "mc-worker progress");
    },
    projectConfigs: config.projects,
  });

  logger.info(
    {
      workerId: config.workerId,
      hostname: os.hostname(),
      maxConcurrentAgents: config.maxConcurrentAgents,
      pollIntervalMs: safePoll,
    },
    "mc-worker daemon started"
  );

  let stopping = false;
  let cleanupInterval: ReturnType<typeof setInterval> | null = null;

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "mc-worker daemon: shutting down");
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
    try {
      await queue.stop();
    } catch (err) {
      logger.warn({ err }, "mc-worker daemon: queue stop failed");
    }
    await orchestrator.waitForIdle();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await queue.start();

  // Cleanup orphaned worktrees at boot and periodically (best-effort).
  const repoPaths = config.projects.map((p) => p.repoPath);
  try {
    await cleanupOrphanedWorktrees({ apiBaseUrl: config.apiUrl, apiKey: config.apiKey, repoPaths });
  } catch (err) {
    logger.warn({ err }, "mc-worker cleanup: failed at startup");
  }
  cleanupInterval = setInterval(() => {
    void cleanupOrphanedWorktrees({ apiBaseUrl: config.apiUrl, apiKey: config.apiKey, repoPaths });
  }, 10 * 60 * 1000);

  const stopHeartbeat = startHeartbeat(
    {
      apiBaseUrl: config.apiUrl,
      apiKey: config.apiKey,
      workerId: config.workerId,
      hostname: os.hostname(),
      config: {
        providers: config.providers,
        maxConcurrentAgents: config.maxConcurrentAgents,
        projects: config.projects.map((p) => p.projectId),
      },
      maxConcurrentAgents: config.maxConcurrentAgents,
    },
    () => orchestrator.getActiveJobIds()
  );

  try {
    while (!stopping) {
      const slots = orchestrator.availableSlots();
      if (slots > 0) {
        try {
          const claimed = await queue.claimJobs(config.workerId, slots);
          for (const job of claimed) {
            void orchestrator.processJob(job);
          }
        } catch (err) {
          logger.warn({ err }, "mc-worker daemon: claimJobs failed");
        }
      }

      await sleep(safePoll);
    }
  } finally {
    stopHeartbeat();
  }
};
