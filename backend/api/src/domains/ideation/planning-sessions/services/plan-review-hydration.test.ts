import { describe, expect, test } from "bun:test";
import { planReviewHydrationResponse } from "./plan-review-hydration";

describe("planReviewHydrationResponse", () => {
  test("returns an idle state when the session has no review admission", () => {
    expect(planReviewHydrationResponse("session-1", null)).toEqual({
      planningSessionId: "session-1",
      reviewJobId: null,
      originalPlanSha256: null,
      status: "idle",
      createdItemIds: [],
      error: null,
    });
  });

  test("maps queued admissions and exposes only created IDs", () => {
    expect(planReviewHydrationResponse("session-1", {
      reviewJobId: "job-1",
      planSha256: "a".repeat(64),
      status: "queued",
      result: {
        generated: {
          createdIds: ["item-1", 42, "item-2"],
          errors: [{ tempId: "task-1", error: "internal detail" }],
        },
        output: { rationale: "private review evidence" },
      },
    })).toEqual({
      planningSessionId: "session-1",
      reviewJobId: "job-1",
      originalPlanSha256: "a".repeat(64),
      status: "pending_review",
      createdItemIds: ["item-1", "item-2"],
      error: null,
    });
  });

  test("maps terminal failures to a user-safe error", () => {
    expect(planReviewHydrationResponse("session-1", {
      reviewJobId: "job-1",
      planSha256: "b".repeat(64),
      status: "failed",
      result: { output: { rationale: "private review evidence" } },
    })).toMatchObject({
      planningSessionId: "session-1",
      reviewJobId: null,
      originalPlanSha256: "b".repeat(64),
      status: "failed",
      createdItemIds: [],
      error: "The plan review failed before creating work items. Review the plan and retry.",
    });
  });
});
