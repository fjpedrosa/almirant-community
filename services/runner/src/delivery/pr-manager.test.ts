import { describe, expect, it } from "bun:test";
import { createExecutionBoundary } from "@almirant/shared";
import { createBranchAndDraftPr } from "./pr-manager";

describe("PR manager execution deadline", () => {
  it("does not start local Git work when token resolution crosses the cutoff", async () => {
    let current = new Date("2026-07-20T12:00:00.000Z");
    const executionBoundary = createExecutionBoundary({
      deadlineAt: new Date("2026-07-20T12:00:00.001Z"),
      now: () => current,
    });

    await expect(createBranchAndDraftPr({
      workerClient: {
        getGithubToken: async () => {
          current = new Date("2026-07-20T12:00:00.001Z");
          return { token: "token" };
        },
      } as never,
      containerManager: {} as never,
    }, {
      workerId: "worker-1",
    }, {
      job: { id: "job-1", config: {} } as never,
      workItem: null,
      repositoryId: "repository-1",
      repoUrl: "https://github.com/acme/site-one",
      baseBranch: "main",
      eventLogger: {
        info: () => {},
        warn: () => {},
      } as never,
      executionBoundary,
    })).rejects.toThrow("execution_boundary_deadline_exceeded");
  });
});
