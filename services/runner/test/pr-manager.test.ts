import { describe, expect, it } from "bun:test";
import { deriveRunnerPrIdentity } from "../src/delivery/pr-manager";

describe("deriveRunnerPrIdentity", () => {
  it("preserves the parent task id as the branch anchor when available", () => {
    const identity = deriveRunnerPrIdentity(
      { id: "job-12345678-aaaa-bbbb-cccc-1234567890ab" } as never,
      {
        id: "child-12345678-aaaa-bbbb-cccc-1234567890ab",
        taskId: "A-T-42",
        title: "Child task",
        parent: {
          id: "parent-12345678-aaaa-bbbb-cccc-1234567890ab",
          taskId: "A-F-9",
          title: "Feature title",
        },
      } as never,
    );

    expect(identity.branchName).toBe("almirant/A-F-9");
    expect(identity.prTitle).toBe("[A-F-9] Feature title");
    expect(identity.contextLines).toContain("- Task: A-T-42 — Child task");
    expect(identity.contextLines).toContain("- Parent: A-F-9 — Feature title");
  });

  it("falls back to the work item id when there is no task id", () => {
    const identity = deriveRunnerPrIdentity(
      { id: "job-12345678-aaaa-bbbb-cccc-1234567890ab" } as never,
      {
        id: "8df0c40f-0111-4222-8333-4f5a6b7c8d9e",
        title: "Implement safety fallback",
      } as never,
    );

    expect(identity.branchName).toBe("almirant/item-8df0c40f");
    expect(identity.prTitle).toBe("[WI-8df0c40f] Implement safety fallback");
    expect(identity.contextLines).toContain("- Work item: WI-8df0c40f — Implement safety fallback");
  });

  it("falls back to the job id when there is no work item", () => {
    const identity = deriveRunnerPrIdentity(
      { id: "cddb26ea-c250-4ff9-a776-3d6d89d24c57" } as never,
      null,
    );

    expect(identity.branchName).toBe("almirant/job-cddb26ea");
    expect(identity.prTitle).toBe("[JOB-cddb26ea] Runner job cddb26ea");
    expect(identity.contextLines).toEqual(["- Job: cddb26ea-c250-4ff9-a776-3d6d89d24c57"]);
  });
});
