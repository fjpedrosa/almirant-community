import { describe, expect, test } from "bun:test";
import { buildSkippedPlanReviewResult, canonicalizePlanReviewPlan, planReviewJobSnapshotSchema } from "@almirant/shared";
import { sanitizePlanReviewTerminalResult } from "./plan-review-worker-result";

const snapshot = planReviewJobSnapshotSchema.parse({
  version: 2,
  intent: "plan-review",
  reviewJobId: "job-worker",
  enabled: true,
  originalPlan: canonicalizePlanReviewPlan({
    projectId: "project-1",
    boardId: "board-1",
    boardColumnId: "column-1",
    items: [{ tempId: "task-1", type: "task", title: "Task", priority: "medium" }],
    dependencies: [],
  }),
  requestedCriticCount: 2,
  maxRevisions: 1,
  synthesizer: null,
  critics: [],
  resolution: {
    status: "skipped",
    degradation: { status: "skipped_unavailable", reason: "fan-out unavailable" },
  },
});

describe("plan-review worker terminal result boundary", () => {
  test("stores only the safe skipped envelope on terminal status", () => {
    const stored = sanitizePlanReviewTerminalResult({
      config: { planReview: snapshot },
      result: { apiKey: "must-not-persist" },
      resultProvided: true,
      status: "completed",
    });

    expect(stored).toEqual({ planReviewOutput: buildSkippedPlanReviewResult("job-worker", snapshot, "fan-out unavailable") });
    expect(JSON.stringify(stored)).not.toContain("apiKey");
  });

  test("terminalizes invalid snapshots without echoing worker data", () => {
    const stored = sanitizePlanReviewTerminalResult({
      config: { planReview: { version: 1, secret: "never-store" } },
      result: { secret: "never-store" },
      resultProvided: true,
      status: "failed",
    });

    expect(stored).toEqual({ planReviewOutput: null, outcome: "not_completed", error: "plan_review_snapshot_invalid" });
  });

  test("does not rewrite a non-terminal status when no result was supplied", () => {
    expect(sanitizePlanReviewTerminalResult({
      config: { planReview: snapshot },
      result: { old: true },
      resultProvided: false,
      status: "running",
    })).toBeNull();
  });
});
