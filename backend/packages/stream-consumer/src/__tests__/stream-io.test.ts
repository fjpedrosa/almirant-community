import { describe, expect, it } from "bun:test";
import {
  createCanonicalStreamEvent,
  createNativeStreamEvent,
  readStreamEvent,
} from "../stream-io";
import type { CanonicalEventEnvelope, NativeEventEnvelope } from "@almirant/canonical-events";
import type { AgentOutputEvent } from "../types";

const envelope: CanonicalEventEnvelope = {
  jobId: "job-1",
  sessionId: "session-1",
  organizationId: "org-1",
  threadId: "thread-1",
  timestamp: 1_710_000_000_000,
  sequenceNumber: 7,
  event: {
    kind: "agent.wave.end",
    successCount: 2,
    totalCount: 3,
  },
};

describe("stream-io", () => {
  it("publica y lee envelopes canónicos sin parseo manual en el consumer", () => {
    const streamEvent = createCanonicalStreamEvent(envelope);
    const result = readStreamEvent(streamEvent);

    expect(result.format).toBe("canonical");
    if (result.format !== "canonical") {
      throw new Error("Se esperaba formato canonical");
    }

    expect(result.envelope).toEqual(envelope);
  });


  it("publica y lee envelopes nativos para diagnóstico", () => {
    const nativeEnvelope: NativeEventEnvelope = {
      jobId: "job-1",
      sessionId: "session-1",
      organizationId: "org-1",
      threadId: "thread-1",
      timestamp: 1_710_000_000_001,
      sequenceNumber: 8,
      nativeEventType: "message.part.updated",
      sourceFormat: "opencode-sse",
      codingAgent: "opencode",
      runtimeSessionId: "ses-native",
      emittedAt: "2026-04-29T21:35:13.000Z",
      payload: { type: "message.part.updated", part: { type: "tool" } },
    };

    const streamEvent = createNativeStreamEvent(nativeEnvelope);
    const result = readStreamEvent(streamEvent);

    expect(result.format).toBe("native");
    if (result.format !== "native") {
      throw new Error("Se esperaba formato native");
    }

    expect(result.envelope).toEqual(nativeEnvelope);
  });

  it("mantiene compatibilidad con eventos legacy", () => {
    const legacyEvent: AgentOutputEvent = {
      jobId: "job-legacy",
      sessionId: "session-legacy",
      organizationId: "org-legacy",
      threadId: "thread-legacy",
      timestamp: 123,
      sequenceNumber: 1,
      type: "message",
      content: "hola",
    };

    const result = readStreamEvent(legacyEvent);

    expect(result).toEqual({
      format: "legacy",
      event: legacyEvent,
    });
  });
});
