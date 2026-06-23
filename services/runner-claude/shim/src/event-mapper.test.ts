import { describe, test, expect } from "bun:test";
import { mapClaudeEventToSse } from "./event-mapper.js";

const SESSION = "test-session-id";

/**
 * Helper: simulate a stream_event:content_block_delta with text_delta.
 */
const textDelta = (text: string) => ({
  type: "stream_event",
  event: {
    type: "content_block_delta",
    delta: { type: "text_delta", text },
  },
});

/**
 * Helper: simulate a partial `assistant` event with accumulated text content.
 */
const assistantPartial = (fullText: string) => ({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "text", text: fullText }],
  },
});

/**
 * Helper: simulate a `result` event (end of turn).
 */
const resultEvent = (text: string) => ({
  type: "result",
  result: text,
});

const toolBlockStart = (name: string, id: string) => ({
  type: "stream_event",
  event: {
    type: "content_block_start",
    content_block: { type: "tool_use", name, id },
  },
});

const inputJsonDelta = (partial_json: string) => ({
  type: "stream_event",
  event: {
    type: "content_block_delta",
    delta: { type: "input_json_delta", partial_json },
  },
});

const blockStop = () => ({
  type: "stream_event",
  event: { type: "content_block_stop" },
});

const assistantAskUserQuestion = (id: string, question: string, options: string[] = []) => ({
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        name: "AskUserQuestion",
        id,
        input: {
          questions: [{ question, options }],
        },
      },
    ],
  },
});

const assistantAskUserQuestions = (
  id: string,
  questions: Array<{ question: string; options?: string[] }>,
) => ({
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        name: "AskUserQuestion",
        id,
        input: { questions },
      },
    ],
  },
});

/**
 * Extract emitted text deltas from a MappingResult.
 * Returns an array of text strings from message.part.delta events with contentType="text".
 */
const extractTextDeltas = (
  result: ReturnType<typeof mapClaudeEventToSse>,
): string[] => {
  return result.events
    .filter(
      (e) =>
        e.type === "message.part.delta" &&
        (e.properties as Record<string, unknown>).contentType === "text",
    )
    .map((e) => (e.properties as Record<string, unknown>).delta as string);
};

describe("mapClaudeEventToSse", () => {
  // NOTE: These tests rely on module-level state in event-mapper.ts.
  // They must run in sequence, simulating a realistic session lifecycle.

  describe("text duplication prevention (multi-turn)", () => {
    test("stream_event deltas emit text correctly", () => {
      // First, send a stream_event to set hasStreamedContent=true
      const r1 = mapClaudeEventToSse(SESSION, textDelta("Hello"));
      const deltas1 = extractTextDeltas(r1);
      expect(deltas1).toEqual(["Hello"]);
      expect(r1.deltaText).toBe("Hello");
    });

    test("assistant snapshot is skipped after stream_event was seen", () => {
      // Now send an assistant partial — it should be SKIPPED since
      // stream_event already streamed the content.
      const r2 = mapClaudeEventToSse(SESSION, assistantPartial("Hello"));
      const deltas2 = extractTextDeltas(r2);
      expect(deltas2).toEqual([]);
    });

    test("more stream_event deltas continue to work", () => {
      const r3 = mapClaudeEventToSse(SESSION, textDelta(" world"));
      const deltas3 = extractTextDeltas(r3);
      expect(deltas3).toEqual([" world"]);
    });

    test("assistant snapshot with full text is still skipped", () => {
      const r4 = mapClaudeEventToSse(
        SESSION,
        assistantPartial("Hello world"),
      );
      const deltas4 = extractTextDeltas(r4);
      expect(deltas4).toEqual([]);
    });

    test("result event ends the turn without breaking dedup", () => {
      const r5 = mapClaudeEventToSse(SESSION, resultEvent("Hello world"));
      // result emits message.part.updated (snapshot), not delta
      const deltas5 = extractTextDeltas(r5);
      expect(deltas5).toEqual([]);
      expect(r5.snapshotText).toBe("Hello world");
    });

    // ---- CRITICAL: This is the test for the bug fix ----
    // After the result event, hasStreamedContent should NOT be reset.
    // If it were reset, this assistant event would emit its full text as
    // a delta, causing duplication with the stream_event deltas that follow.

    test("REGRESSION: assistant event after result does NOT emit duplicate text", () => {
      // Simulate turn 2: an assistant partial arrives BEFORE stream_event deltas.
      // With the bug (hasStreamedContent reset to false), this would emit
      // "## Phase 1" as a delta — causing duplication.
      // With the fix, hasStreamedContent stays true and this is skipped.
      const r6 = mapClaudeEventToSse(
        SESSION,
        assistantPartial("## Phase 1"),
      );
      const deltas6 = extractTextDeltas(r6);
      expect(deltas6).toEqual([]);
    });

    test("stream_event deltas in turn 2 still work correctly", () => {
      const r7 = mapClaudeEventToSse(SESSION, textDelta("## Phase 1"));
      const deltas7 = extractTextDeltas(r7);
      expect(deltas7).toEqual(["## Phase 1"]);
    });

    test("assistant snapshot in turn 2 is skipped", () => {
      const r8 = mapClaudeEventToSse(
        SESSION,
        assistantPartial("## Phase 1: Capture & Understand"),
      );
      const deltas8 = extractTextDeltas(r8);
      expect(deltas8).toEqual([]);
    });

    test("subsequent stream_event deltas in turn 2 work", () => {
      const r9 = mapClaudeEventToSse(
        SESSION,
        textDelta(": Capture & Understand"),
      );
      const deltas9 = extractTextDeltas(r9);
      expect(deltas9).toEqual([": Capture & Understand"]);
    });
  });

  describe("AskUserQuestion in stream_event mode", () => {
    test("emits question.asked once and requiresInput for streamed AskUserQuestion", () => {
      const start = mapClaudeEventToSse(
        SESSION,
        toolBlockStart("AskUserQuestion", "ask-stream-1"),
      );
      expect(start.events).toHaveLength(1);
      expect(start.requiresInput).toBeUndefined();

      mapClaudeEventToSse(
        SESSION,
        inputJsonDelta('{"questions":[{"question":"Which approach?","options":["Option A","Option B"]}]}'),
      );

      const stop = mapClaudeEventToSse(SESSION, blockStop());
      const questionEvents = stop.events.filter((event) => event.type === "question.asked");
      expect(questionEvents).toHaveLength(1);
      expect((questionEvents[0].properties as Record<string, unknown>).text).toBe("Which approach?");
      expect((questionEvents[0].properties as Record<string, unknown>).options).toEqual([
        "Option A",
        "Option B",
      ]);
      expect(stop.requiresInput).toBe(true);

      const assistantSnapshot = mapClaudeEventToSse(
        SESSION,
        assistantAskUserQuestion("ask-stream-1", "Which approach?", ["Option A", "Option B"]),
      );
      const duplicateQuestionEvents = assistantSnapshot.events.filter(
        (event) => event.type === "question.asked",
      );
      expect(duplicateQuestionEvents).toHaveLength(0);

      mapClaudeEventToSse(SESSION, resultEvent(""));
    });

    test("question.asked carries grouped questions", () => {
      const result = mapClaudeEventToSse(
        SESSION,
        assistantAskUserQuestions("ask-grouped-1", [
          { question: "Pregunta 1", options: ["A", "B"] },
          { question: "Pregunta 2", options: ["C"] },
        ]),
      );

      const questionEvents = result.events.filter(
        (event) => event.type === "question.asked",
      );
      expect(questionEvents).toHaveLength(1);
      expect((questionEvents[0].properties as Record<string, unknown>).questions).toEqual([
        { text: "Pregunta 1", options: ["A", "B"] },
        { text: "Pregunta 2", options: ["C"] },
      ]);
    });
  });

  describe("assistant-only mode (no stream_event)", () => {
    // When stream_event events are NOT available (older CLI version),
    // assistant events should still work as the text source.
    // This test can't fully verify this because the module-level state
    // from previous tests means hasStreamedContent is already true.
    // In a fresh module load, hasStreamedContent would be false and
    // assistant events would emit text.

    test("result event ends turn 2 cleanly", () => {
      const r = mapClaudeEventToSse(
        SESSION,
        resultEvent("## Phase 1: Capture & Understand"),
      );
      expect(r.snapshotText).toBe("## Phase 1: Capture & Understand");
    });
  });
});
