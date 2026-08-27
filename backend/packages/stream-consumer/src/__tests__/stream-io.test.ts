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
  workspaceId: "org-1",
  threadId: "thread-1",
  timestamp: 1_710_000_000_000,
  sequenceNumber: 7,
  sequenceProtocolVersion: "durable.v2",
  claimAttemptId: "attempt-1",
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
    expect(result.envelope.sequenceProtocolVersion).toBe("durable.v2");
  });


  it("publica y lee envelopes nativos para diagnóstico", () => {
    const nativeEnvelope: NativeEventEnvelope = {
      jobId: "job-1",
      sessionId: "session-1",
      workspaceId: "org-1",
      threadId: "thread-1",
      timestamp: 1_710_000_000_001,
      sequenceNumber: 8,
      sequenceProtocolVersion: "durable.v2",
      claimAttemptId: "attempt-1",
      nativeEventType: "message.part.updated",
      sourceFormat: "opencode-sse",
      provider: "zipu",
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.3",
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

  it("no añade campos runtime-selection a productores nativos existentes", () => {
    const existingEnvelope: NativeEventEnvelope = {
      jobId: "job-existing",
      sessionId: "session-existing",
      workspaceId: "org-existing",
      threadId: "thread-existing",
      timestamp: 1_710_000_000_002,
      sequenceNumber: 9,
      nativeEventType: "message.part.updated",
      sourceFormat: "opencode-sse",
      provider: "zipu",
      codingAgent: "opencode",
      runtimeSessionId: "ses-existing",
      emittedAt: "2026-04-29T21:35:14.000Z",
      payload: { type: "message.part.updated" },
    };

    const streamEvent = createNativeStreamEvent(existingEnvelope);
    const result = readStreamEvent(streamEvent);

    expect(Object.hasOwn(streamEvent, "aiProvider")).toBe(false);
    expect(Object.hasOwn(streamEvent, "model")).toBe(false);
    expect(result).toEqual({ format: "native", envelope: existingEnvelope });
  });

  it("mantiene compatibilidad con eventos legacy", () => {
    const legacyEvent: AgentOutputEvent = {
      jobId: "job-legacy",
      sessionId: "session-legacy",
      workspaceId: "org-legacy",
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

  it("falla cerrado ante un protocolo durable desconocido", () => {
    const malformed = {
      ...createCanonicalStreamEvent(envelope),
      sequenceProtocolVersion: "durable.v3",
    } as unknown as AgentOutputEvent;

    expect(() => readStreamEvent(malformed)).toThrow(
      "unsupported sequence protocol",
    );
  });

  it("falla cerrado cuando durable.v2 no incluye claimAttemptId", () => {
    const { claimAttemptId: _claimAttemptId, ...withoutClaim } =
      createCanonicalStreamEvent(envelope);

    expect(() => readStreamEvent(withoutClaim as AgentOutputEvent)).toThrow(
      "durable.v2 requires claimAttemptId",
    );
  });
});
