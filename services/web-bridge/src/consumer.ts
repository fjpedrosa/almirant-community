import {
  createStreamReader,
  type StreamReader,
  type AgentOutputEvent,
  parseEvent,
  createCoalescer,
  type CoalescedBatch,
  type Coalescer,
  createCanonicalRouter,
  type CanonicalEventEnvelope,
  readStreamEvent,
} from "@almirant/stream-consumer";
import Redis from "ioredis";
import type { BridgeEnv } from "./config";
import type { ProcessingStats } from "./types";
import { TERMINAL_EVENT_TYPES, COALESCEABLE_EVENT_TYPES } from "./types";
import { mapEventToWsMessage } from "./event-mapper";
import {
  createApiClient,
  type ApiClient,
  createEventPersistenceStrategy,
  type EventPersistenceStrategy,
} from "./api-client";
import { createWebRenderer } from "./web-renderer";
import { createSequenceGuard } from "./sequence-guard";

/** Bridge-specific context fields spread into every coalesced batch. */
type WebBridgeBatchContext = {
  sessionId: string;
  workspaceId: string;
};

type WebBridgeBatch = CoalescedBatch<WebBridgeBatchContext>;

type ConsumerDeps = {
  env: BridgeEnv;
  redisConnectionString: string;
  log: (level: string, message: string, meta?: Record<string, unknown>) => void;
  now?: () => number;
};

export type WebBridgeConsumer = {
  start: () => void;
  stop: () => Promise<void>;
  getStats: () => ProcessingStats;
};

export const createWebBridgeConsumer = (
  deps: ConsumerDeps
): WebBridgeConsumer => {
  const { env, redisConnectionString, log, now: nowFn } = deps;
  const startedAt = (nowFn ?? Date.now)();
  let totalProcessed = 0;
  let totalFailed = 0;
  let totalCoalesced = 0;
  let totalPublished = 0;
  let lastProcessedAt: string | null = null;

  let reader: StreamReader | null = null;
  let coalescer: Coalescer | null = null;
  let pubsubRedis: Redis | null = null;
  let apiClient: ApiClient | null = null;
  let eventPersistence: EventPersistenceStrategy | null = null;

  const handleFlush = async (batch: WebBridgeBatch): Promise<void> => {
    const redis = pubsubRedis;
    if (!redis) return;

    try {
      for (const event of batch.events) {
        const wsMessage = mapEventToWsMessage(event);
        if (!wsMessage) continue;

        const payload = JSON.stringify({
          workspaceId: batch.workspaceId,
          message: wsMessage,
        });

        await redis.publish(env.PUBSUB_CHANNEL, payload);
        totalPublished += 1;
      }

      totalCoalesced += batch.events.length;
      log("debug", `Flushed batch for session ${batch.sessionId}`, {
        sessionId: batch.sessionId,
        eventCount: batch.events.length,
        steps: batch.combinedSteps.length,
        passthrough: batch.passthrough.length,
      });
    } catch (error) {
      totalFailed += batch.events.length;
      log("error", `Failed to flush batch for session ${batch.sessionId}`, {
        sessionId: batch.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    start: () => {
      // Create a dedicated Redis connection for Pub/Sub publishing
      pubsubRedis = new Redis(redisConnectionString, {
        maxRetriesPerRequest: null,
        lazyConnect: false,
      });

      pubsubRedis.on("error", (error: Error) => {
        log("error", "Redis Pub/Sub connection error", {
          error: error.message,
        });
      });

      // Initialize API client for canonical events (optional — only if configured)
      if (env.BACKEND_API_URL && env.BRIDGE_API_KEY) {
        apiClient = createApiClient({
          baseUrl: env.BACKEND_API_URL,
          apiKey: env.BRIDGE_API_KEY,
          log,
        });
        eventPersistence = createEventPersistenceStrategy(apiClient, log);
        log("info", "API client initialized for canonical event processing", {
          baseUrl: env.BACKEND_API_URL,
        });
      }

      // Create the WebRenderer + canonical router for canonical events
      const webRenderer = createWebRenderer({
        pubsubRedis: pubsubRedis,
        pubsubChannel: env.PUBSUB_CHANNEL,
        log,
        onPublish: () => { totalPublished += 1; },
      });
      const routeCanonical = createCanonicalRouter(webRenderer);

      coalescer = createCoalescer<WebBridgeBatchContext>({
        idleMs: env.COALESCE_IDLE_MS,
        maxWaitMs: env.COALESCE_MAX_WAIT_MS,
        onFlush: handleFlush,
        keyExtractor: (event) => event.sessionId,
        terminalTypes: TERMINAL_EVENT_TYPES,
        coalesceableTypes: COALESCEABLE_EVENT_TYPES,
        buildContext: (event) => ({
          sessionId: event.sessionId,
          workspaceId: event.workspaceId,
        }),
        now: nowFn,
      });

      const coalescerRef = coalescer;
      const eventPersistenceRef = eventPersistence;

      // Per-job monotonic sequence tracking and dedup guard
      const seqGuard = createSequenceGuard();

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

      // The handler receives raw fields from Redis — we detect the format
      // and route accordingly.
      reader.start(async (event: AgentOutputEvent, ack) => {
        try {
          const streamEvent = readStreamEvent(event);

          if (streamEvent.format === "native") {
            if (eventPersistenceRef) {
              await eventPersistenceRef.persistNativeEvent(
                {
                  sequenceNum: streamEvent.envelope.sequenceNumber,
                  nativeEventType: streamEvent.envelope.nativeEventType,
                  sourceFormat: streamEvent.envelope.sourceFormat,
                  payload: streamEvent.envelope.payload,
                  provider: streamEvent.envelope.provider,
                  codingAgent: streamEvent.envelope.codingAgent,
                  runtimeSessionId: streamEvent.envelope.runtimeSessionId,
                  emittedAt: streamEvent.envelope.emittedAt,
                },
                { jobId: streamEvent.envelope.jobId },
              );
            }

            totalProcessed += 1;
            lastProcessedAt = new Date().toISOString();
            await ack();
          } else if (streamEvent.format === "canonical") {
            const canonicalEvent = streamEvent.envelope.event;
            const sessionId = streamEvent.envelope.sessionId;
            const workspaceId = streamEvent.envelope.workspaceId;

            // DEBUG: log all canonical event kinds to verify tool calls flow
            if (!["agent.text", "agent.thinking", "heartbeat"].includes(canonicalEvent.kind)) {
              log("info", `[CANONICAL] ${canonicalEvent.kind}`, {
                jobId: event.jobId,
                sessionId,
              });
            }

            // Route canonical event through WebRenderer → Redis Pub/Sub
            const envelope: CanonicalEventEnvelope = {
              ...streamEvent.envelope,
              threadId: event.jobId,
              sequenceNumber: seqGuard.nextSequence(event.jobId),
            };

            // Dedup: reject out-of-order or duplicate envelopes
            if (seqGuard.isRegression(event.jobId, envelope.sequenceNumber)) {
              log("warn", `Dropping out-of-order/duplicate envelope`, {
                jobId: event.jobId,
                sequenceNumber: envelope.sequenceNumber,
                kind: canonicalEvent.kind,
              });
              totalProcessed += 1;
              lastProcessedAt = new Date().toISOString();
              await ack();
              return;
            }

            await routeCanonical(envelope);

            // Persist to session_events table for replay on refresh
            if (eventPersistenceRef) {
              await eventPersistenceRef.persistCanonicalEvent(
                canonicalEvent,
                {
                  jobId: event.jobId,
                  sequenceNumber: envelope.sequenceNumber,
                  provider: (event as Record<string, unknown>).provider as
                    | string
                    | undefined,
                },
              );
            }

            // Clean up tracking maps when a job reaches a terminal state
            if (
              canonicalEvent.kind === "job.completed" ||
              canonicalEvent.kind === "job.incomplete" ||
              canonicalEvent.kind === "job.failed" ||
              canonicalEvent.kind === "job.cancelled"
            ) {
              seqGuard.cleanup(event.jobId);
            }

            totalProcessed += 1;
            lastProcessedAt = new Date().toISOString();
            await ack();
          } else {
            // Old format — use coalescer path
            log("debug", `Processing event ${streamEvent.event.type} for session ${streamEvent.event.sessionId}`, {
              jobId: streamEvent.event.jobId,
              type: streamEvent.event.type,
              sessionId: streamEvent.event.sessionId,
            });

            coalescerRef.push(streamEvent.event);
            totalProcessed += 1;
            lastProcessedAt = new Date().toISOString();
            await ack();
          }
        } catch (error) {
          totalFailed += 1;
          log("error", `Error processing event`, {
            jobId: event.jobId,
            sessionId: event.sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error; // Re-throw so StreamReader records the failure for retry
        }
      });

      log("info", `StreamReader started on stream "${env.STREAM_NAME}" (group: ${env.CONSUMER_GROUP})`, {
        batchSize: env.BATCH_SIZE,
        coalesceIdleMs: env.COALESCE_IDLE_MS,
        coalesceMaxWaitMs: env.COALESCE_MAX_WAIT_MS,
        pubsubChannel: env.PUBSUB_CHANNEL,
        canonicalApiEnabled: !!apiClient,
      });
    },

    stop: async () => {
      log("info", "Stopping web-bridge consumer...");

      if (eventPersistence) {
        await eventPersistence.flushAll();
        eventPersistence.destroy();
        eventPersistence = null;
      }

      if (coalescer) {
        await coalescer.flushAll();
        coalescer.destroy();
        coalescer = null;
      }

      if (reader) {
        await reader.stop();
        reader = null;
      }

      if (pubsubRedis) {
        pubsubRedis.disconnect();
        pubsubRedis = null;
      }

      apiClient = null;

      log("info", "Web-bridge consumer stopped.");
    },

    getStats: (): ProcessingStats => ({
      totalProcessed,
      totalFailed,
      totalCoalesced,
      totalPublished,
      lastProcessedAt,
      uptimeSeconds: Math.round(((nowFn ?? Date.now)() - startedAt) / 1000),
    }),
  };
};
