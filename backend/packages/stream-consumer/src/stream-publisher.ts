import Redis from "ioredis";
import type { CanonicalEventEnvelope, NativeEventEnvelope } from "@almirant/canonical-events";
import type { AgentOutputEvent, StreamPublisherConfig } from "./types";
import { DEFAULT_STREAM_NAME, DEFAULT_MAX_LEN } from "./types";
import { createCanonicalStreamEvent, createNativeStreamEvent } from "./stream-io";

// ---------------------------------------------------------------------------
// StreamPublisher — writes AgentOutputEvents to a Redis Stream via XADD
// ---------------------------------------------------------------------------

export type StreamPublisher = {
  publish: (event: AgentOutputEvent) => Promise<string>;
  publishCanonicalEnvelope: (envelope: CanonicalEventEnvelope) => Promise<string>;
  publishNativeEnvelope: (envelope: NativeEventEnvelope) => Promise<string>;
  close: () => Promise<void>;
};

/**
 * Flatten an AgentOutputEvent into key-value pairs suitable for XADD.
 *
 * - Simple scalar fields are converted to strings directly.
 * - Arrays and objects (`options`, `agents`, `payload`) are JSON-stringified.
 * - Undefined/null fields are omitted entirely.
 */
const flattenEvent = (event: AgentOutputEvent): string[] => {
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
  addField("organizationId", event.organizationId);
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

  // Support canonical event envelope fields (_format, event)
  const extra = event as Record<string, unknown>;
  if (typeof extra._format === "string") {
    addField("_format", extra._format);
  }
  if (typeof extra.event === "string") {
    addField("event", extra.event);
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
  if (typeof extra.runtimeSessionId === "string") {
    addField("runtimeSessionId", extra.runtimeSessionId);
  }
  if (typeof extra.emittedAt === "string") {
    addField("emittedAt", extra.emittedAt);
  }

  return fields;
};

export const createStreamPublisher = (
  config: StreamPublisherConfig
): StreamPublisher => {
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  const streamName = config.streamName ?? DEFAULT_STREAM_NAME;
  const maxLen = config.maxLen ?? DEFAULT_MAX_LEN;

  const publish = async (event: AgentOutputEvent): Promise<string> => {
    const fields = flattenEvent(event);
    // XADD stream MAXLEN ~ maxLen * field1 value1 field2 value2 ...
    const entryId = await redis.xadd(
      streamName,
      "MAXLEN",
      "~",
      maxLen,
      "*",
      ...fields
    );
    return entryId as string;
  };

  const publishCanonicalEnvelope = async (
    envelope: CanonicalEventEnvelope,
  ): Promise<string> => publish(createCanonicalStreamEvent(envelope));

  const publishNativeEnvelope = async (
    envelope: NativeEventEnvelope,
  ): Promise<string> => publish(createNativeStreamEvent(envelope));

  const close = async (): Promise<void> => {
    await redis.quit();
  };

  return { publish, publishCanonicalEnvelope, publishNativeEnvelope, close };
};
