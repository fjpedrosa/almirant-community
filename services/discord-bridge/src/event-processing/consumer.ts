// ---------------------------------------------------------------------------
// Discord Bridge Consumer — canonical-only event processing
//
// Reads events from the Redis stream and routes canonical events through:
//   1. CanonicalRouter -> DiscordRenderer (Discord UI output)
//   2. routeCanonicalEventToApi (DB persistence via backend API)
//
// Legacy events are logged as warnings and acked without processing.
// Button management (sticky "Processing..." message) is handled after
// non-streaming canonical events to avoid Discord API spam.
// ---------------------------------------------------------------------------

import {
  createStreamReader,
  type StreamReader,
  createCanonicalRouter,
  type CanonicalEventEnvelope,
  type CanonicalEvent,
  readStreamEvent,
} from "@almirant/stream-consumer";
import type { DiscordRichChannelAdapter } from "@almirant/remote-agent";
import { buildSessionControlComponents } from "@almirant/remote-agent";
import type { BridgeEnv } from "../config";
import type { AgentOutputEvent, ProcessingStats } from "../types";
import type { DiscordRendererWithState } from "../rendering/renderer";
import { type ApiClient } from "../job-persistence/api-client";
import { createEventPersistenceStrategy } from "../job-persistence/event-router";
import type { Logger } from "../platform/logger";
import { withRetry } from "../platform/retry";
import {
  isTerminalEvent,
  isButtonTrigger,
  isStreamingEvent,
} from "./event-classifier";

// ---------------------------------------------------------------------------
// Consumer types
// ---------------------------------------------------------------------------

type ConsumerDeps = {
  renderer: DiscordRendererWithState;
  discordAdapter: DiscordRichChannelAdapter;
  env: BridgeEnv;
  redisConnectionString: string;
  log: Logger;
  now?: () => number;
  apiClient?: ApiClient | null;
  threadNameRegistry?: Map<string, string>;
};

export type DiscordBridgeConsumer = {
  start: () => void;
  stop: () => Promise<void>;
  getStats: () => ProcessingStats;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createDiscordBridgeConsumer = (
  deps: ConsumerDeps,
): DiscordBridgeConsumer => {
  const {
    renderer,
    discordAdapter,
    env,
    redisConnectionString,
    log,
    now: nowFn,
    apiClient,
    threadNameRegistry,
  } = deps;

  const startedAt = (nowFn ?? Date.now)();
  let totalProcessed = 0;
  let totalFailed = 0;
  let totalPublished = 0;
  let lastProcessedAt: string | null = null;
  let reader: StreamReader | null = null;
  const eventPersistence = apiClient
    ? createEventPersistenceStrategy(apiClient, log)
    : null;

  const registeredJobs = new Set<string>();

  const retryOpts = {
    maxRetries: env.MAX_RETRIES,
    baseDelayMs: env.RETRY_BASE_DELAY_MS,
  };

  // -------------------------------------------------------------------------
  // Button management
  // -------------------------------------------------------------------------

  const manageButtons = async (jobId: string, threadId: string): Promise<void> => {
    if (renderer.getTerminatedJobs().has(jobId)) return;
    if (renderer.getPendingButtonOp().has(jobId)) return;

    renderer.getPendingButtonOp().add(jobId);
    try {
      const oldTracked = renderer.getStatusMessages().get(jobId);

      const buttonMsg = await withRetry<{ id: string }>(
        () =>
          discordAdapter.sendRichMessage(threadId, {
            content: "\u28CB Processing...",
            components: buildSessionControlComponents(jobId, "running"),
            allowed_mentions: { parse: [] },
          }),
        { ...retryOpts, label: "button-message" },
      );

      renderer.setStatusMessage(jobId, buttonMsg.id, threadId);

      if (oldTracked) {
        try {
          await discordAdapter.deleteMessage(oldTracked.threadId, oldTracked.messageId);
        } catch { /* best-effort */ }
      }
    } finally {
      renderer.getPendingButtonOp().delete(jobId);
    }
  };

  // -------------------------------------------------------------------------
  // Consumer lifecycle
  // -------------------------------------------------------------------------

  return {
    start: () => {
      const routeEvent = createCanonicalRouter(renderer);

      reader = createStreamReader({
        redisUrl: redisConnectionString,
        streamName: env.STREAM_NAME,
        consumerGroup: env.CONSUMER_GROUP,
        consumerId: env.CONSUMER_ID,
        batchSize: env.BATCH_SIZE,
        retry: {
          maxRetries: 5,
          baseDelayMs: 200,
          maxDelayMs: 30_000,
        },
      });

      reader.start(async (event: AgentOutputEvent, ack) => {
        try {
          const streamEvent = readStreamEvent(event);

          if (streamEvent.format === "native") {
            // Native diagnostic events are persisted by the web bridge path;
            // Discord rendering intentionally ignores them.
            totalProcessed += 1;
            lastProcessedAt = new Date().toISOString();
            await ack();
          } else if (streamEvent.format === "canonical") {
            const canonicalEvent: CanonicalEvent = streamEvent.envelope.event;
            const threadId = streamEvent.envelope.threadId;
            const jobId = streamEvent.envelope.jobId;

            if (!registeredJobs.has(jobId) && threadNameRegistry) {
              registeredJobs.add(jobId);
              const name = threadNameRegistry.get(threadId);
              if (name) renderer.setThreadName(jobId, threadId, name);
            }

            if (!isStreamingEvent(canonicalEvent.kind)) {
              log("info", `[CANONICAL] ${canonicalEvent.kind}`, { jobId, threadId });
            }

            const envelope: CanonicalEventEnvelope = {
              ...streamEvent.envelope,
              sequenceNumber: streamEvent.envelope.sequenceNumber,
            };

            const renderPromise = routeEvent(envelope);
            const apiPromise = eventPersistence
              ? eventPersistence.persistCanonicalEvent(canonicalEvent, {
                  jobId,
                  sequenceNumber: streamEvent.envelope.sequenceNumber,
                })
              : Promise.resolve();

            await Promise.all([renderPromise, apiPromise]);

            totalPublished += 1;
            totalProcessed += 1;
            lastProcessedAt = new Date().toISOString();
            await ack();

            if (!isTerminalEvent(canonicalEvent.kind) && isButtonTrigger(canonicalEvent.kind)) {
              try {
                await manageButtons(jobId, threadId);
              } catch (error) {
                log("warn", "Button management failed", {
                  jobId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          } else {
            log("warn", "Legacy event received, skipping", {
              type: streamEvent.event.type,
              jobId: streamEvent.event.jobId,
              threadId: streamEvent.event.threadId,
            });
            totalProcessed += 1;
            lastProcessedAt = new Date().toISOString();
            await ack();
          }
        } catch (error) {
          totalFailed += 1;
          log("error", "Error processing event", {
            jobId: event.jobId,
            threadId: event.threadId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      });

      log("info", `StreamReader started on stream "${env.STREAM_NAME}" (group: ${env.CONSUMER_GROUP})`, {
        batchSize: env.BATCH_SIZE,
        canonicalOnly: true,
        apiEnabled: !!apiClient,
      });
    },

    stop: async () => {
      log("info", "Stopping discord-bridge consumer...");
      if (eventPersistence) {
        await eventPersistence.flushAll();
        eventPersistence.destroy();
      }
      if (reader) {
        await reader.stop();
        reader = null;
      }
      log("info", "Discord-bridge consumer stopped.");
    },

    getStats: (): ProcessingStats => ({
      totalProcessed,
      totalFailed,
      totalPublished,
      lastProcessedAt,
      uptimeSeconds: Math.round(((nowFn ?? Date.now)() - startedAt) / 1000),
    }),
  };
};
