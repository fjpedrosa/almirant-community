import { describe, expect, it } from "bun:test";
import {
  deserializeCanonicalEnvelope,
  isCanonicalFormat,
  serializeCanonicalEnvelope,
  type CanonicalEventEnvelope,
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
});
