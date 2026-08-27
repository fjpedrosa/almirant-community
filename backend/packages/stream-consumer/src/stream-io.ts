import {
  deserializeCanonicalEnvelope,
  deserializeNativeEnvelope,
  serializeCanonicalEnvelope,
  serializeNativeEnvelope,
  type CanonicalEventEnvelope,
  type NativeEventEnvelope,
} from "@almirant/canonical-events";
import type { AgentOutputEvent } from "./types";

type FormattedStreamEvent = AgentOutputEvent & {
  _format?: string;
  event?: string;
  nativeEventType?: string;
  sourceFormat?: string;
  provider?: string;
  codingAgent?: string;
  aiProvider?: string;
  model?: string;
  runtimeSessionId?: string;
  emittedAt?: string;
  sequenceProtocolVersion?: "durable.v2";
  claimAttemptId?: string;
};

export type StreamReadResult =
  | {
      format: "canonical";
      envelope: CanonicalEventEnvelope;
    }
  | {
      format: "native";
      envelope: NativeEventEnvelope;
    }
  | {
      format: "legacy";
      event: AgentOutputEvent;
    };

const toCanonicalStreamEvent = (
  envelope: CanonicalEventEnvelope,
): AgentOutputEvent => {
  const serialized = serializeCanonicalEnvelope(envelope);
  const map = new Map<string, string>();

  for (let i = 0; i < serialized.length; i += 2) {
    const key = serialized[i];
    const value = serialized[i + 1];
    if (key === undefined || value === undefined) {
      continue;
    }
    map.set(key, value);
  }

  return {
    jobId: envelope.jobId,
    sessionId: envelope.sessionId,
    workspaceId: envelope.workspaceId,
    threadId: envelope.threadId,
    timestamp: envelope.timestamp,
    sequenceNumber: envelope.sequenceNumber,
    sequenceProtocolVersion: map.get("sequenceProtocolVersion") as "durable.v2" | undefined,
    claimAttemptId: map.get("claimAttemptId"),
    type: "message",
    _format: map.get("_format"),
    event: map.get("event"),
  } as AgentOutputEvent;
};

export const createCanonicalStreamEvent = (
  envelope: CanonicalEventEnvelope,
): AgentOutputEvent => toCanonicalStreamEvent(envelope);

const toNativeStreamEvent = (
  envelope: NativeEventEnvelope,
): AgentOutputEvent => {
  const serialized = serializeNativeEnvelope(envelope);
  const map = new Map<string, string>();

  for (let i = 0; i < serialized.length; i += 2) {
    const key = serialized[i];
    const value = serialized[i + 1];
    if (key === undefined || value === undefined) {
      continue;
    }
    map.set(key, value);
  }

  return {
    jobId: envelope.jobId,
    sessionId: envelope.sessionId,
    workspaceId: envelope.workspaceId,
    threadId: envelope.threadId,
    timestamp: envelope.timestamp,
    sequenceNumber: envelope.sequenceNumber,
    sequenceProtocolVersion: map.get("sequenceProtocolVersion") as "durable.v2" | undefined,
    claimAttemptId: map.get("claimAttemptId"),
    type: "raw",
    payload: envelope.payload,
    _format: map.get("_format"),
    nativeEventType: map.get("nativeEventType"),
    sourceFormat: map.get("sourceFormat"),
    provider: map.get("provider"),
    codingAgent: map.get("codingAgent"),
    ...(map.get("aiProvider") ? { aiProvider: map.get("aiProvider")! } : {}),
    ...(map.get("model") ? { model: map.get("model")! } : {}),
    runtimeSessionId: map.get("runtimeSessionId"),
    emittedAt: map.get("emittedAt"),
  } as AgentOutputEvent;
};

export const createNativeStreamEvent = (
  envelope: NativeEventEnvelope,
): AgentOutputEvent => toNativeStreamEvent(envelope);

const legacy = (event: AgentOutputEvent): StreamReadResult => ({
  format: "legacy",
  event,
});

export const readStreamEvent = (event: AgentOutputEvent): StreamReadResult => {
  const rawEvent = event as FormattedStreamEvent;

  if (rawEvent._format === "canonical" && typeof rawEvent.event === "string") {
    const envelope = deserializeCanonicalEnvelope([
      "jobId",
      event.jobId,
      "sessionId",
      event.sessionId,
      "workspaceId",
      event.workspaceId,
      "threadId",
      event.threadId,
      "timestamp",
      String(event.timestamp),
      "sequenceNumber",
      String(event.sequenceNumber),
      ...(rawEvent.sequenceProtocolVersion
        ? ["sequenceProtocolVersion", rawEvent.sequenceProtocolVersion]
        : []),
      ...(rawEvent.claimAttemptId
        ? ["claimAttemptId", rawEvent.claimAttemptId]
        : []),
      "_format",
      rawEvent._format,
      "event",
      rawEvent.event,
    ]);

    return envelope ? { format: "canonical", envelope } : legacy(event);
  }

  if (rawEvent._format === "native") {
    const payload =
      typeof event.payload === "object" && event.payload !== null
        ? JSON.stringify(event.payload)
        : JSON.stringify({ value: event.payload ?? null });
    const envelope = deserializeNativeEnvelope([
      "jobId",
      event.jobId,
      "sessionId",
      event.sessionId,
      "workspaceId",
      event.workspaceId,
      "threadId",
      event.threadId,
      "timestamp",
      String(event.timestamp),
      "sequenceNumber",
      String(event.sequenceNumber),
      ...(rawEvent.sequenceProtocolVersion
        ? ["sequenceProtocolVersion", rawEvent.sequenceProtocolVersion]
        : []),
      ...(rawEvent.claimAttemptId
        ? ["claimAttemptId", rawEvent.claimAttemptId]
        : []),
      "_format",
      rawEvent._format,
      "nativeEventType",
      rawEvent.nativeEventType ?? "unknown",
      "sourceFormat",
      rawEvent.sourceFormat ?? "sse",
      "payload",
      payload,
      ...(rawEvent.provider ? ["provider", rawEvent.provider] : []),
      ...(rawEvent.codingAgent ? ["codingAgent", rawEvent.codingAgent] : []),
      ...(rawEvent.aiProvider ? ["aiProvider", rawEvent.aiProvider] : []),
      ...(rawEvent.model ? ["model", rawEvent.model] : []),
      ...(rawEvent.runtimeSessionId ? ["runtimeSessionId", rawEvent.runtimeSessionId] : []),
      ...(rawEvent.emittedAt ? ["emittedAt", rawEvent.emittedAt] : []),
    ]);

    return envelope ? { format: "native", envelope } : legacy(event);
  }

  return legacy(event);
};
