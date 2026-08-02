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
  normalizeCanonicalEnvelope,
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
import {
  assertValidDurableSequence,
  createSequenceGuard,
} from "./sequence-guard";

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
  apiClient?: ApiClient | null;
  now?: () => number;
};

export type WebBridgeConsumer = {
  start: () => void;
  stop: () => Promise<void>;
  getStats: () => ProcessingStats;
};

/**
 * Build the envelope that leaves the bridge.
 *
 * Durable-v2 producers own both their sequence namespace and event identity.
 * Legacy producers do not: their process-local sequence may restart when the
 * same job resumes, so the bridge assigns a monotonic sequence and MUST derive
 * a matching identity from it. Keeping the producer eventId would make a later
 * attempt look like a duplicate during projection rebuilds.
 */
export const buildOutboundCanonicalEnvelope = (
  input: CanonicalEventEnvelope,
  sequenceNumber: number,
  sequenceProtocolVersion: CanonicalEventEnvelope["sequenceProtocolVersion"],
): CanonicalEventEnvelope => {
  const reassigned: CanonicalEventEnvelope = {
    ...input,
    threadId: input.jobId,
    sequenceNumber,
  };

  if (sequenceProtocolVersion === "durable.v2") {
    return reassigned;
  }

  const { eventId: _staleEventId, ...withoutStaleIdentity } = reassigned;
  const metadata =
    reassigned.event.metadata &&
    typeof reassigned.event.metadata === "object" &&
    !Array.isArray(reassigned.event.metadata)
      ? reassigned.event.metadata
      : {};
  const { eventId: _staleMetadataEventId, ...metadataWithoutStaleIdentity } =
    metadata;

  return normalizeCanonicalEnvelope({
    ...withoutStaleIdentity,
    event: {
      ...reassigned.event,
      metadata: metadataWithoutStaleIdentity,
    },
  });
};

/**
 * Per-job turnstile: at most one holder per jobId, granted in arrival order.
 *
 * Page concurrency exists for the native channel, which is never rendered and has
 * no ordering requirement. Canonical events have both: they are published to the
 * user in sequence order and their inserts all contend on one agent_jobs row.
 * Serializing them per job keeps render order, insert order and the lock
 * contention profile exactly as they are under the sequential loop.
 *
 * Handlers enter in dispatch order because Redis replies are FIFO per connection
 * and every idempotency check goes through the reader's single client, so dispatch
 * order is stream order. A check that fails leaves its entry pending for
 * redelivery, which is already what happens today.
 */
export const createJobTurnstile = () => {
  const tails = new Map<string, Promise<void>>();
  return async (jobId: string): Promise<() => void> => {
    const previous = tails.get(jobId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => mine);
    tails.set(jobId, tail);
    await previous;
    return () => {
      release();
      if (tails.get(jobId) === tail) tails.delete(jobId);
    };
  };
};

export const createWebBridgeConsumer = (
  deps: ConsumerDeps
): WebBridgeConsumer => {
  const {
    env,
    redisConnectionString,
    log,
    apiClient: injectedApiClient,
    now: nowFn,
  } = deps;
  const startedAt = (nowFn ?? Date.now)();
  let totalProcessed = 0;
  let totalFailed = 0;
  let totalCoalesced = 0;
  let totalPublished = 0;
  let lastProcessedAt: string | null = null;

  let reader: StreamReader | null = null;
  let coalescer: Coalescer | null = null;
  let pubsubRedis: Redis | null = null;
  let apiClient: ApiClient | null = injectedApiClient ?? null;
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
      if (!apiClient && env.BACKEND_API_URL && env.BRIDGE_API_KEY) {
        apiClient = createApiClient({
          baseUrl: env.BACKEND_API_URL,
          apiKey: env.BRIDGE_API_KEY,
          log,
        });
      }
      if (apiClient) {
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
      const acquireCanonicalTurn = createJobTurnstile();

      reader = createStreamReader({
        redisUrl: redisConnectionString,
        streamName: env.STREAM_NAME,
        consumerGroup: env.CONSUMER_GROUP,
        consumerId: env.CONSUMER_ID,
        batchSize: env.BATCH_SIZE,
        pageConcurrency: env.PAGE_CONCURRENCY,
        retry: {
          maxRetries: 5,
          baseDelayMs: 200,
          maxDelayMs: 30_000,
        },
      });

      // The handler receives raw fields from Redis — we detect the format
      // and route accordingly.
      reader.start(async (event: AgentOutputEvent, ack) => {
        let releaseCanonicalTurn: (() => void) | undefined;
        try {
          const streamEvent = readStreamEvent(event);

          // Native events batch freely across the page. Canonical events are
          // re-serialized per job so ordering and lock contention are unchanged.
          if (streamEvent.format === "canonical") {
            releaseCanonicalTurn = await acquireCanonicalTurn(event.jobId);
          }

          if (streamEvent.format === "native") {
            if (
              streamEvent.envelope.sequenceProtocolVersion === "durable.v2"
            ) {
              assertValidDurableSequence(
                streamEvent.envelope.sequenceNumber,
              );
            }
            if (
              streamEvent.envelope.sequenceProtocolVersion === "durable.v2" &&
              !eventPersistenceRef
            ) {
              throw new Error(
                "durable.v2 native persistence requires BACKEND_API_URL and BRIDGE_API_KEY",
              );
            }
            if (eventPersistenceRef) {
              await eventPersistenceRef.persistNativeEvent(
                {
                  sequenceNum: streamEvent.envelope.sequenceNumber,
                  sequenceProtocolVersion:
                    streamEvent.envelope.sequenceProtocolVersion,
                  claimAttemptId: streamEvent.envelope.claimAttemptId,
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
            const hasDurableProducerSequence =
              streamEvent.envelope.sequenceProtocolVersion === "durable.v2";

            // DEBUG: log all canonical event kinds to verify tool calls flow
            if (!["agent.text", "agent.thinking", "heartbeat"].includes(canonicalEvent.kind)) {
              log("info", `[CANONICAL] ${canonicalEvent.kind}`, {
                jobId: event.jobId,
                sessionId,
              });
            }

            // A reused jobId starting a new attempt on a fresh, ephemeral
            // runner republishes job.started with a producer sequence that
            // restarts low. The quota-pause and pre-session-timeout retry
            // paths reuse the jobId WITHOUT emitting a terminal event, so the
            // high-water mark was never cleaned up. Reset it here (before the
            // regression check) so the resumed attempt's events are not
            // mistaken for stale/duplicate redeliveries and dropped forever.
            if (canonicalEvent.kind === "job.started" && !hasDurableProducerSequence) {
              seqGuard.resetHighWater(event.jobId);
            }

            // Dedup: reject out-of-order or duplicate envelopes based on
            // the PRODUCER-assigned sequence number, BEFORE selecting the
            // outbound one (checking a bridge-local fallback would never
            // detect a regression — it is monotonic by construction).
            //
            // Envelopes WITHOUT a producer sequence number (e.g. an older
            // producer during a rolling deploy) are NOT deduped: feeding a
            // non-finite value to the guard would either drop legitimate
            // events or poison the high-water mark. Bypass the guard instead.
            const producerSequenceNumber = streamEvent.envelope.sequenceNumber;
            if (
              Number.isFinite(producerSequenceNumber) &&
              seqGuard.isRegression(
                event.jobId,
                producerSequenceNumber,
                streamEvent.envelope.sequenceProtocolVersion,
              )
            ) {
              log("warn", `Dropping out-of-order/duplicate envelope`, {
                jobId: event.jobId,
                producerSequenceNumber: streamEvent.envelope.sequenceNumber,
                kind: canonicalEvent.kind,
              });
              totalProcessed += 1;
              lastProcessedAt = new Date().toISOString();
              await ack();
              return;
            }

            // Route canonical event through WebRenderer → Redis Pub/Sub with
            // the exact producer sequence. Only legacy envelopes without a
            // finite sequence receive a bridge-local fallback.
            const envelope = buildOutboundCanonicalEnvelope(
              streamEvent.envelope,
              seqGuard.resolveOutboundSequence(
                event.jobId,
                producerSequenceNumber,
                streamEvent.envelope.sequenceProtocolVersion,
              ),
              streamEvent.envelope.sequenceProtocolVersion,
            );

            if (hasDurableProducerSequence && !eventPersistenceRef) {
              throw new Error(
                "durable.v2 canonical persistence requires BACKEND_API_URL and BRIDGE_API_KEY",
              );
            }

            // The durable database insert is intentionally before rendering
            // and before StreamReader-owned XACK. A crash after this call is a
            // safe idempotent redelivery; the persisted projection is the
            // source of truth for reconnect/replay.
            let shouldRender = true;
            if (eventPersistenceRef) {
              shouldRender = await eventPersistenceRef.persistCanonicalEvent(
                envelope.event,
                {
                  jobId: event.jobId,
                  sequenceNumber: envelope.sequenceNumber,
                  provider: (event as Record<string, unknown>).provider as
                    | string
                    | undefined,
                  sequenceProtocolVersion:
                    envelope.sequenceProtocolVersion,
                  claimAttemptId: envelope.claimAttemptId,
                },
              );
            }

            // A durable redelivery that inserted zero rows has already crossed
            // the DB boundary. ACK it without publishing a duplicate live row.
            // Legacy events always return true and preserve historical routing.
            if (shouldRender) {
              await routeCanonical(envelope);
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
        } finally {
          releaseCanonicalTurn?.();
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

      const failures: unknown[] = [];

      // Stop intake and wait every in-flight handler before flushing batchers;
      // otherwise a handler can enqueue after flushAll has already returned.
      if (reader) {
        try {
          await reader.stop();
        } catch (error) {
          failures.push(error);
        }
        reader = null;
      }

      if (eventPersistence) {
        try {
          await eventPersistence.flushAll();
          eventPersistence.destroy();
        } catch (error) {
          failures.push(error);
        }
        eventPersistence = null;
      }

      if (coalescer) {
        await coalescer.flushAll();
        coalescer.destroy();
        coalescer = null;
      }

      if (pubsubRedis) {
        pubsubRedis.disconnect();
        pubsubRedis = null;
      }

      apiClient = null;

      if (failures.length === 1) {
        throw failures[0];
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          "web-bridge shutdown left persistence errors pending",
        );
      }

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
