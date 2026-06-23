// ---------------------------------------------------------------------------
// HTTP Server — Elysia routes for health, stats, and thread management
// ---------------------------------------------------------------------------

import { Elysia } from "elysia";
import type { DiscordRichChannelAdapter } from "@almirant/remote-agent";
import type { Logger } from "./logger";
import type { BridgeEnv } from "../config";
import type { ProcessingStats } from "../types";
import { buildThreadName } from "../thread-management/job-labels";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HttpServerDeps = {
  env: BridgeEnv;
  discordAdapter: DiscordRichChannelAdapter;
  log: Logger;
  threadNameRegistry: Map<string, string>;
  getStats: () => ProcessingStats;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createHttpServer = (deps: HttpServerDeps) => {
  const { env, discordAdapter, log, threadNameRegistry, getStats } = deps;

  return new Elysia()
    .get("/health", () => ({
      ok: true,
      service: "discord-bridge",
      stream: env.STREAM_NAME,
      consumerGroup: env.CONSUMER_GROUP,
      stats: getStats(),
      uptimeSeconds: Math.round(process.uptime()),
    }))
    .get("/stats", () => getStats())
    .post("/threads", async ({ body, set }) => {
      const { jobType, taskId, channelId, initialMessage } = body as {
        jobType?: string;
        taskId?: string;
        channelId?: string;
        initialMessage?: string;
      };

      const targetChannelId = channelId || env.DISCORD_CHANNEL_ID;
      const humanId = taskId || "job";
      const threadName = buildThreadName(jobType ?? "implementation", humanId);

      try {
        const thread = await discordAdapter.createThread({
          channelId: targetChannelId,
          name: threadName,
          autoArchiveDurationMinutes: 1440,
        });

        const message = initialMessage ?? `\u{23F3} Job encolado para ${humanId}. Esperando runner disponible...`;
        void discordAdapter.sendMessage(thread.id, message).catch((err) => {
          log("warn", "Failed to send initial thread message", {
            threadId: thread.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        threadNameRegistry.set(thread.id, threadName);
        log("info", "Thread created via API", { threadId: thread.id, threadName, taskId: humanId });

        return { threadId: thread.id, threadName: thread.name };
      } catch (error) {
        log("error", "Failed to create Discord thread", {
          error: error instanceof Error ? error.message : String(error),
          channelId: targetChannelId,
          threadName,
        });
        set.status = 502;
        return { error: "Failed to create Discord thread" };
      }
    })
    .post("/threads/:threadId/rename", async ({ params, body, set }) => {
      const { threadId } = params;
      const { name } = body as { name?: string };

      if (!name || !name.trim()) {
        set.status = 400;
        return { error: "name is required" };
      }

      try {
        const thread = await discordAdapter.renameThread(threadId, name.trim());
        threadNameRegistry.set(threadId, name.trim());
        log("info", "Thread renamed via API", { threadId, name: name.trim() });
        return { threadId: thread.id, threadName: thread.name };
      } catch (error) {
        log("error", "Failed to rename Discord thread", {
          threadId,
          name,
          error: error instanceof Error ? error.message : String(error),
        });
        set.status = 502;
        return { error: "Failed to rename Discord thread" };
      }
    });
};
