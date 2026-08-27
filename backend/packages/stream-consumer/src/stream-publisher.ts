import Redis from "ioredis";
import {
  assertValidNativeEventMetadata,
  assertValidSequenceProtocolMetadata,
  type CanonicalEventEnvelope,
  type NativeEventEnvelope,
} from "@almirant/canonical-events";
import type { AgentOutputEvent, StreamPublisherConfig } from "./types";
import { DEFAULT_STREAM_NAME } from "./types";
import { createCanonicalStreamEvent, createNativeStreamEvent } from "./stream-io";

// ---------------------------------------------------------------------------
// StreamPublisher — writes AgentOutputEvents to a Redis Stream via XADD
// ---------------------------------------------------------------------------

export type StreamPublisherOperationOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type StreamPublisher = {
  publish: (
    event: AgentOutputEvent,
    options?: StreamPublisherOperationOptions,
  ) => Promise<string>;
  publishCanonicalEnvelope: (
    envelope: CanonicalEventEnvelope,
    options?: StreamPublisherOperationOptions,
  ) => Promise<string>;
  publishNativeEnvelope: (
    envelope: NativeEventEnvelope,
    options?: StreamPublisherOperationOptions,
  ) => Promise<string>;
  close: (options?: StreamPublisherOperationOptions) => Promise<void>;
};

/**
 * Flatten an AgentOutputEvent into key-value pairs suitable for XADD.
 *
 * - Simple scalar fields are converted to strings directly.
 * - Arrays and objects (`options`, `agents`, `payload`) are JSON-stringified.
 * - Undefined/null fields are omitted entirely.
 */
export const flattenEvent = (event: AgentOutputEvent): string[] => {
  assertValidSequenceProtocolMetadata(event as Record<string, unknown>);
  const fields: string[] = [];

  const addField = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;

    if (typeof value === "object") {
      fields.push(key, JSON.stringify(value));
    } else {
      fields.push(key, String(value));
    }
  };

  addField("jobId", event.jobId);
  addField("sessionId", event.sessionId);
  addField("workspaceId", event.workspaceId);
  addField("threadId", event.threadId);
  addField("timestamp", event.timestamp);
  addField("sequenceNumber", event.sequenceNumber);
  addField("type", event.type);
  addField("content", event.content);
  addField("contentType", event.contentType);
  addField("description", event.description);
  addField("summary", event.summary);
  addField("reason", event.reason);
  addField("text", event.text);
  addField("options", event.options);
  addField("agents", event.agents);
  addField("agent", event.agent);
  addField("taskId", event.taskId);
  addField("status", event.status);
  addField("successCount", event.successCount);
  addField("totalCount", event.totalCount);
  addField("elapsedMs", event.elapsedMs);
  addField("payload", event.payload);
  addField("name", event.name);
  addField("messageId", event.messageId);
  addField("emoji", event.emoji);

  // Support canonical and native envelope fields.
  const extra = event as Record<string, unknown>;
  if (extra._format === "native") {
    assertValidNativeEventMetadata(extra);
  }
  if (typeof extra._format === "string") {
    addField("_format", extra._format);
  }
  if (typeof extra.event === "string") {
    addField("event", extra.event);
  }
  if (extra.sequenceProtocolVersion === "durable.v2") {
    addField("sequenceProtocolVersion", extra.sequenceProtocolVersion);
  }
  if (typeof extra.claimAttemptId === "string") {
    addField("claimAttemptId", extra.claimAttemptId);
  }
  if (typeof extra.nativeEventType === "string") {
    addField("nativeEventType", extra.nativeEventType);
  }
  if (typeof extra.sourceFormat === "string") {
    addField("sourceFormat", extra.sourceFormat);
  }
  if (typeof extra.provider === "string") {
    addField("provider", extra.provider);
  }
  if (typeof extra.codingAgent === "string") {
    addField("codingAgent", extra.codingAgent);
  }
  if (typeof extra.aiProvider === "string") {
    addField("aiProvider", extra.aiProvider);
  }
  if (typeof extra.model === "string") {
    addField("model", extra.model);
  }
  if (typeof extra.runtimeSessionId === "string") {
    addField("runtimeSessionId", extra.runtimeSessionId);
  }
  if (typeof extra.emittedAt === "string") {
    addField("emittedAt", extra.emittedAt);
  }

  return fields;
};

/**
 * Build a lossless XADD command tail.
 *
 * Retention cannot be imposed at publish time: MAXLEN is stream-wide, so a
 * legacy producer could delete an unread or pending durable.v2 entry belonging
 * to another consumer group. Capacity must be monitored and reclaimed only at
 * a proven all-group ACK frontier. Until that exists, growth is safer than loss.
 */
export const buildXAddArguments = (event: AgentOutputEvent): string[] => [
  "*",
  ...flattenEvent(event),
];

export const createStreamPublisher = (
  config: StreamPublisherConfig
): StreamPublisher => {
  const commandTimeout = config.commandTimeoutMs ?? 30_000;
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    commandTimeout,
  });
  const streamName = config.streamName ?? DEFAULT_STREAM_NAME;
  let terminatedReason: unknown;
  let closed = false;
  let closeInFlight: Promise<void> | null = null;

  const resolveSignal = (
    options?: StreamPublisherOperationOptions,
  ): AbortSignal | undefined => {
    const timeoutSignal =
      options?.timeoutMs !== undefined
        ? AbortSignal.timeout(Math.max(1, Math.ceil(options.timeoutMs)))
        : undefined;
    if (options?.signal && timeoutSignal) {
      return AbortSignal.any([options.signal, timeoutSignal]);
    }
    return options?.signal ?? timeoutSignal;
  };

  const terminate = (reason: unknown): void => {
    terminatedReason ??= reason;
    redis.disconnect(false);
  };

  const runRedisOperation = async <T>(
    operation: () => Promise<T>,
    options?: StreamPublisherOperationOptions,
  ): Promise<T> => {
    if (terminatedReason) throw terminatedReason;
    if (closed) throw new Error("Redis stream publisher is closed");
    const signal = resolveSignal(options);
    if (signal?.aborted) {
      const reason = signal.reason ?? new Error("Redis stream operation aborted");
      terminate(reason);
      throw reason;
    }
    const pending = operation();
    pending.catch(() => undefined);
    if (!signal) return pending;

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        const reason =
          signal.reason ?? new Error("Redis stream operation aborted");
        terminate(reason);
        reject(reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });

    try {
      const result = await Promise.race([pending, aborted]);
      if (signal.aborted) {
        const reason =
          signal.reason ?? new Error("Redis stream operation aborted");
        terminate(reason);
        throw reason;
      }
      return result;
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  };

  const publish = async (
    event: AgentOutputEvent,
    options?: StreamPublisherOperationOptions,
  ): Promise<string> => {
    const entryId = await runRedisOperation(
      () => redis.xadd(streamName, ...buildXAddArguments(event)),
      options,
    );
    return entryId as string;
  };

  const publishCanonicalEnvelope = async (
    envelope: CanonicalEventEnvelope,
    options?: StreamPublisherOperationOptions,
  ): Promise<string> => publish(createCanonicalStreamEvent(envelope), options);

  const publishNativeEnvelope = async (
    envelope: NativeEventEnvelope,
    options?: StreamPublisherOperationOptions,
  ): Promise<string> => publish(createNativeStreamEvent(envelope), options);

  const close = async (
    options?: StreamPublisherOperationOptions,
  ): Promise<void> => {
    if (closeInFlight) return closeInFlight;
    closeInFlight = (async () => {
      try {
        if (terminatedReason) {
          throw terminatedReason;
        }
        await runRedisOperation(() => redis.quit(), options);
      } finally {
        closed = true;
        // QUIT itself can stall after the socket accepts the command. A hard
        // disconnect guarantees no Redis work survives the caller's deadline.
        redis.disconnect(false);
      }
    })();
    return closeInFlight;
  };

  return { publish, publishCanonicalEnvelope, publishNativeEnvelope, close };
};
