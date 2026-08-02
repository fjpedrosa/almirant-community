import { describe, expect, it } from "bun:test";
import { createScheduledAgentTerminalSweeper } from "./scheduled-agent-terminal-sweeper";

describe("scheduled agent terminal sweeper", () => {
  it("deduplicates output/run recovery candidates and isolates per-job retries", async () => {
    const reconciled: string[] = [];
    const failed: string[] = [];
    const sweeper = createScheduledAgentTerminalSweeper({
      findOutputCandidates: async () => [
        { id: "job-output" },
        { id: "job-shared" },
      ],
      findRunCandidates: async () => [
        "job-run",
        "job-shared",
        "job-error",
      ],
      reconcile: async (jobId) => {
        reconciled.push(jobId);
        if (jobId === "job-error") throw new Error("transient database error");
        return jobId !== "job-output";
      },
      onError: (jobId) => {
        failed.push(jobId);
      },
    });

    expect(await sweeper.sweep({ limit: 25 })).toEqual({
      pending: 4,
      reconciled: 2,
    });
    expect(reconciled).toEqual([
      "job-output",
      "job-shared",
      "job-run",
      "job-error",
    ]);
    expect(failed).toEqual(["job-error"]);
  });
});
