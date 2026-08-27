import { describe, expect, it } from "bun:test";
import {
  deserializeCanonicalEnvelope,
  deserializeNativeEnvelope,
  isCanonicalFormat,
  serializeCanonicalEnvelope,
  serializeNativeEnvelope,
  type CanonicalEventEnvelope,
  type NativeEventEnvelope,
} from "./index";

const envelope: CanonicalEventEnvelope = {
  jobId: "job-1",
  sessionId: "session-1",
  workspaceId: "org-1",
  threadId: "thread-1",
  timestamp: 1_710_000_000_000,
  sequenceNumber: 42,
  event: {
    kind: "agent.tool_call.start",
    toolName: "Read",
    toolCallId: "tc-1",
    inputPreview: "path: /tmp/file.ts",
  },
};

describe("@almirant/canonical-events", () => {
  it("serializa y deserializa envelopes sin perder datos", () => {
    const serialized = serializeCanonicalEnvelope(envelope);
    const deserialized = deserializeCanonicalEnvelope(serialized);

    expect(deserialized).toEqual(envelope);
  });

  it("detecta el formato canonical en campos Redis", () => {
    expect(isCanonicalFormat(serializeCanonicalEnvelope(envelope))).toBe(true);
    expect(isCanonicalFormat(["jobId", "job-1"])).toBe(false);
  });

  it("serializa eventos agent.summary preservando text y section", () => {
    const summaryEnvelope: CanonicalEventEnvelope = {
      ...envelope,
      sequenceNumber: 99,
      event: {
        kind: "agent.summary",
        text: "Implementé el fix y añadí 3 tests.",
        section: "Summary",
      },
    };

    const serialized = serializeCanonicalEnvelope(summaryEnvelope);
    const deserialized = deserializeCanonicalEnvelope(serialized);

    expect(deserialized).toEqual(summaryEnvelope);
    expect(deserialized?.event.kind).toBe("agent.summary");
    if (deserialized?.event.kind === "agent.summary") {
      expect(deserialized.event.text).toBe("Implementé el fix y añadí 3 tests.");
      expect(deserialized.event.section).toBe("Summary");
    }
  });

  it("acepta section Resumen en agent.summary", () => {
    const summaryEnvelope: CanonicalEventEnvelope = {
      ...envelope,
      event: {
        kind: "agent.summary",
        text: "Trabajo terminado.",
        section: "Resumen",
      },
    };

    const deserialized = deserializeCanonicalEnvelope(
      serializeCanonicalEnvelope(summaryEnvelope),
    );
    if (deserialized?.event.kind === "agent.summary") {
      expect(deserialized.event.section).toBe("Resumen");
    } else {
      throw new Error("expected agent.summary");
    }
  });

  it("marca sequenceNumber ausente como NaN (no lo colapsa a 0)", () => {
    // An envelope produced by an older runner during a rolling deploy may not
    // carry a sequenceNumber. Collapsing it to 0 makes the web-bridge dedup
    // guard treat the second such envelope as a regression and drop it.
    // Absent sequence numbers must be represented as a non-finite value so the
    // consumer can bypass dedup instead of dropping legitimate events.
    const serialized = serializeCanonicalEnvelope(envelope);
    const withoutSeq: string[] = [];
    for (let i = 0; i < serialized.length; i += 2) {
      if (serialized[i] === "sequenceNumber") continue;
      withoutSeq.push(serialized[i]!, serialized[i + 1]!);
    }

    const deserialized = deserializeCanonicalEnvelope(withoutSeq);
    expect(deserialized).not.toBeNull();
    expect(Number.isNaN(deserialized!.sequenceNumber)).toBe(true);
    expect(deserialized!.sequenceNumber).not.toBe(0);
  });

  it("keeps infrastructure, AI provider, and exact model in separate native lanes", () => {
    const native: NativeEventEnvelope = {
      jobId: "job-pi",
      sessionId: "session-pi",
      workspaceId: "org-pi",
      threadId: "thread-pi",
      timestamp: 1_710_000_000_100,
      sequenceNumber: 43,
      nativeEventType: "message_end",
      sourceFormat: "pi-rpc",
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      runtimeSessionId: "pi-runtime-session",
      emittedAt: "2026-08-21T12:00:00.000Z",
      payload: { type: "message_end" },
    };

    const parsed = deserializeNativeEnvelope(serializeNativeEnvelope(native));

    expect(parsed).toEqual(native);
    expect(parsed?.provider).toBe("zipu");
    expect(parsed?.aiProvider).toBe("zai");
    expect(parsed?.model).toBe("glm-5.3");
    expect(parsed?.provider).not.toBe(parsed?.aiProvider);
  });

  it("keeps native producer payloads without runtime-selection fields byte-for-byte compatible", () => {
    const existing: NativeEventEnvelope = {
      jobId: "job-existing",
      sessionId: "session-existing",
      workspaceId: "org-existing",
      threadId: "thread-existing",
      timestamp: 1_710_000_000_200,
      sequenceNumber: 44,
      nativeEventType: "message.part.updated",
      sourceFormat: "opencode-sse",
      provider: "zipu",
      codingAgent: "opencode",
      runtimeSessionId: "runtime-existing",
      emittedAt: "2026-08-21T12:00:01.000Z",
      payload: { type: "message.part.updated" },
    };

    const serialized = serializeNativeEnvelope(existing);

    expect(serialized).toEqual([
      "jobId", "job-existing",
      "sessionId", "session-existing",
      "workspaceId", "org-existing",
      "threadId", "thread-existing",
      "timestamp", "1710000000200",
      "sequenceNumber", "44",
      "nativeEventType", "message.part.updated",
      "sourceFormat", "opencode-sse",
      "payload", '{"type":"message.part.updated"}',
      "_format", "native",
      "provider", "zipu",
      "codingAgent", "opencode",
      "runtimeSessionId", "runtime-existing",
      "emittedAt", "2026-08-21T12:00:01.000Z",
    ]);
    expect(deserializeNativeEnvelope(serialized)).toEqual(existing);
    expect(serialized).not.toContain("aiProvider");
    expect(serialized).not.toContain("model");
  });

  it("rejects invalid infrastructure lanes and unbounded runtime identity strings", () => {
    const native: NativeEventEnvelope = {
      jobId: "job-bounds",
      sessionId: "session-bounds",
      workspaceId: "org-bounds",
      threadId: "thread-bounds",
      timestamp: 1_710_000_000_300,
      sequenceNumber: 45,
      nativeEventType: "message_end",
      sourceFormat: "pi-rpc",
      provider: "zipu",
      codingAgent: "pi",
      aiProvider: "zai",
      model: "glm-5.3",
      payload: { type: "message_end" },
    };

    expect(() =>
      serializeNativeEnvelope({
        ...native,
        provider: "zai",
      } as unknown as NativeEventEnvelope),
    ).toThrow("provider must be an infrastructure provider");
    expect(() =>
      serializeNativeEnvelope({
        ...native,
        aiProvider: "z".repeat(257),
      }),
    ).toThrow("aiProvider");
    expect(() =>
      serializeNativeEnvelope({
        ...native,
        model: "m".repeat(257),
      }),
    ).toThrow("model");
  });

  it("reads a legacy AI provider from provider without returning it in the infrastructure lane", () => {
    const serialized = serializeNativeEnvelope({
      jobId: "job-legacy-provider",
      sessionId: "session-legacy-provider",
      workspaceId: "org-legacy-provider",
      threadId: "thread-legacy-provider",
      timestamp: 1_710_000_000_400,
      sequenceNumber: 46,
      nativeEventType: "message_end",
      sourceFormat: "legacy-rpc",
      payload: { type: "message_end" },
    });
    serialized.push("provider", "zai");

    const parsed = deserializeNativeEnvelope(serialized);

    expect(parsed?.provider).toBeUndefined();
    expect(parsed?.aiProvider).toBe("zai");
  });
});
