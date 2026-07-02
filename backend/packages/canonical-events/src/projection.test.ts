import { describe, expect, it } from "bun:test";
import {
  buildCanonicalSessionProjection,
  normalizeCanonicalEnvelope,
  reduceCanonicalSessionProjection,
  createInitialCanonicalSessionProjection,
  type CanonicalEventEnvelope,
} from "./index";

const envelope = (
  sequenceNumber: number,
  event: CanonicalEventEnvelope["event"],
  extra: Partial<CanonicalEventEnvelope> = {},
): CanonicalEventEnvelope => ({
  jobId: "job-1",
  sessionId: "session-1",
  workspaceId: "workspace-1",
  threadId: "thread-1",
  timestamp: 1_700_000_000_000 + sequenceNumber,
  sequenceNumber,
  ...extra,
  event,
});

describe("canonical v2 envelope normalization", () => {
  it("adds stable protocol metadata without removing the original event", () => {
    const normalized = normalizeCanonicalEnvelope(
      envelope(7, { kind: "agent.text", content: "hola" }, { turnId: "turn-1" }),
    );

    expect(normalized.protocolVersion).toBe("canonical.v2");
    expect(normalized.schemaVersion).toBe("canonical.v2");
    expect(normalized.eventId).toBe("job-1:7:agent.text");
    expect(normalized.turnId).toBe("turn-1");
    expect(normalized.event.metadata?.eventId).toBe("job-1:7:agent.text");
    expect(normalized.event.metadata?.turnId).toBe("turn-1");
  });
});

describe("canonical session projection reducer", () => {
  it("materializes turn state, transcript, blocking question, answer and completion", () => {
    const projection = buildCanonicalSessionProjection([
      envelope(0, { kind: "turn.started", turnId: "turn-1", reason: "user_prompt" }, { turnId: "turn-1" }),
      envelope(1, { kind: "agent.text", content: "Necesito " }, { turnId: "turn-1" }),
      envelope(2, { kind: "agent.text", content: "aclaración" }, { turnId: "turn-1" }),
      envelope(
        3,
        {
          kind: "agent.question",
          questionId: "q-1",
          questionText: "¿Qué prioridad usamos?",
          options: ["Alta", "Media"],
          questionType: "single_choice",
        },
        { turnId: "turn-1" },
      ),
      envelope(4, { kind: "turn.awaiting_user", turnId: "turn-1", interactionId: "q-1" }, { turnId: "turn-1" }),
      envelope(5, { kind: "user.answer.submitted", questionId: "q-1", answerPreview: "Alta" }, { turnId: "turn-1" }),
      envelope(6, { kind: "turn.resumed", turnId: "turn-1", interactionId: "q-1" }, { turnId: "turn-1" }),
      envelope(7, { kind: "job.completed", summary: "Listo" }, { turnId: "turn-1" }),
    ]);

    expect(projection?.status).toBe("completed");
    expect(projection?.activeQuestion).toBeNull();
    expect(projection?.blocks).toHaveLength(1);
    expect(projection?.blocks[0]).toMatchObject({
      type: "text",
      content: "Necesito aclaración",
      firstSequence: 1,
      lastSequence: 2,
    });
  });

  it("is idempotent for duplicate event ids and records out-of-order events", () => {
    const base = createInitialCanonicalSessionProjection({
      sessionId: "session-1",
      jobId: "job-1",
      workspaceId: "workspace-1",
    });

    const first = reduceCanonicalSessionProjection(
      base,
      envelope(10, { kind: "agent.text", content: "A" }, { eventId: "event-a" }),
    );
    const duplicate = reduceCanonicalSessionProjection(
      first,
      envelope(10, { kind: "agent.text", content: "A" }, { eventId: "event-a" }),
    );
    const outOfOrder = reduceCanonicalSessionProjection(
      duplicate,
      envelope(9, { kind: "agent.text", content: "B" }, { eventId: "event-b" }),
    );

    expect(duplicate.duplicateCount).toBe(1);
    expect(outOfOrder.outOfOrderCount).toBe(1);
    expect(outOfOrder.lastSequenceNumber).toBe(10);
  });
});
