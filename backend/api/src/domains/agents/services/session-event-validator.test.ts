import { describe, expect, it } from "bun:test";
import {
  validateCompletionEventIntegrity,
  type SessionEventRecord,
} from "./session-event-validator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEvent = (
  sequenceNum: number,
  kind: string,
  payload: Record<string, unknown> = {},
): SessionEventRecord => ({
  sequenceNum,
  kind,
  payload,
});

/**
 * Returns a complete set of events that satisfies the completion contract.
 * Tests that add or remove events from this set can verify specific gaps.
 */
const completeEventSet = (): SessionEventRecord[] => [
  makeEvent(1, "agent.wave.start", {
    agents: [{ taskId: "task-A" }, { taskId: "task-B" }],
  }),
  makeEvent(2, "agent.text", { content: "working on task..." }),
  makeEvent(3, "agent.wave.agent_done", { taskId: "task-A" }),
  makeEvent(4, "agent.wave.agent_done", { taskId: "task-B" }),
  makeEvent(5, "agent.text.complete", { fullText: "## Summary\nAll done" }),
  makeEvent(6, "job.completed", { summary: "## Summary\nAll done" }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateCompletionEventIntegrity", () => {
  it("passes validation for a complete event set", () => {
    const result = validateCompletionEventIntegrity(completeEventSet());

    expect(result.isComplete).toBe(true);
    expect(result.missingKinds).toEqual([]);
    // Warnings about gaps/ordering are fine, but no structural issues
    expect(
      result.warnings.some((w) => w.includes("Unmatched wave tasks")),
    ).toBe(false);
  });

  it("detects missing agent.text.complete", () => {
    const events = completeEventSet().filter(
      (e) => e.kind !== "agent.text.complete",
    );

    const result = validateCompletionEventIntegrity(events);

    expect(result.isComplete).toBe(false);
    expect(result.missingKinds).toContain("agent.text.complete");
  });

  it("detects missing job.completed", () => {
    const events = completeEventSet().filter(
      (e) => e.kind !== "job.completed",
    );

    const result = validateCompletionEventIntegrity(events);

    expect(result.isComplete).toBe(false);
    expect(result.missingKinds).toContain("job.completed");
  });

  it("detects missing agent.text.complete when agent.text chunks exist", () => {
    const events: SessionEventRecord[] = [
      makeEvent(1, "agent.text", { content: "hello" }),
      makeEvent(2, "agent.text", { content: "world" }),
      makeEvent(3, "job.completed", { summary: "done" }),
    ];

    const result = validateCompletionEventIntegrity(events);

    expect(result.isComplete).toBe(false);
    expect(result.missingKinds).toContain("agent.text.complete");
    expect(
      result.warnings.some((w) =>
        w.includes("agent.text chunks exist but no agent.text.complete"),
      ),
    ).toBe(true);
  });

  it("detects unmatched wave tasks", () => {
    const events: SessionEventRecord[] = [
      makeEvent(1, "agent.wave.start", {
        agents: [{ taskId: "task-X" }, { taskId: "task-Y" }],
      }),
      makeEvent(2, "agent.wave.agent_done", { taskId: "task-X" }),
      // task-Y never completed
      makeEvent(3, "agent.text.complete", { fullText: "done" }),
      makeEvent(4, "job.completed", {}),
    ];

    const result = validateCompletionEventIntegrity(events);

    expect(result.isComplete).toBe(true); // Terminal events exist
    expect(
      result.warnings.some((w) => w.includes("Unmatched wave tasks")),
    ).toBe(true);
    expect(
      result.warnings.some((w) => w.includes("task-Y")),
    ).toBe(true);
  });

  it("produces warning for out-of-order events", () => {
    const events: SessionEventRecord[] = [
      makeEvent(1, "agent.text", { content: "first" }),
      makeEvent(5, "agent.text.complete", { fullText: "done" }),
      makeEvent(3, "job.completed", {}), // out of order
    ];

    const result = validateCompletionEventIntegrity(events);

    expect(
      result.warnings.some((w) => w.includes("Out-of-order")),
    ).toBe(true);
  });

  it("produces warning for sequence number gaps", () => {
    const events: SessionEventRecord[] = [
      makeEvent(1, "agent.text", { content: "start" }),
      // sequenceNum 2 is missing
      makeEvent(3, "agent.text.complete", { fullText: "end" }),
      makeEvent(4, "job.completed", {}),
    ];

    const result = validateCompletionEventIntegrity(events);

    expect(result.isComplete).toBe(true);
    expect(
      result.warnings.some((w) => w.includes("Sequence gaps detected")),
    ).toBe(true);
  });

  it("handles empty event list", () => {
    const result = validateCompletionEventIntegrity([]);

    expect(result.isComplete).toBe(false);
    expect(result.missingKinds).toContain("agent.text.complete");
    expect(result.missingKinds).toContain("job.completed");
    expect(
      result.warnings.some((w) => w.includes("No events provided")),
    ).toBe(true);
  });

  it("handles events without wave tasks gracefully", () => {
    const events: SessionEventRecord[] = [
      makeEvent(1, "agent.text", { content: "simple job" }),
      makeEvent(2, "agent.text.complete", { fullText: "done" }),
      makeEvent(3, "job.completed", { summary: "done" }),
    ];

    const result = validateCompletionEventIntegrity(events);

    expect(result.isComplete).toBe(true);
    expect(result.missingKinds).toEqual([]);
    expect(
      result.warnings.some((w) => w.includes("Unmatched wave tasks")),
    ).toBe(false);
  });

  it("does not report gaps when events are contiguous", () => {
    const events: SessionEventRecord[] = [
      makeEvent(1, "agent.text", { content: "a" }),
      makeEvent(2, "agent.text.complete", { fullText: "b" }),
      makeEvent(3, "job.completed", {}),
    ];

    const result = validateCompletionEventIntegrity(events);

    expect(
      result.warnings.some((w) => w.includes("Sequence gaps")),
    ).toBe(false);
  });

  it("does not flag agent.text.complete as missing when no agent.text chunks exist", () => {
    // job.completed alone is sufficient when there are no text chunks
    const events: SessionEventRecord[] = [
      makeEvent(1, "agent.text.complete", { fullText: "done" }),
      makeEvent(2, "job.completed", { summary: "done" }),
    ];

    const result = validateCompletionEventIntegrity(events);

    expect(result.isComplete).toBe(true);
    expect(result.missingKinds).toEqual([]);
  });
});
