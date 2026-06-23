import { beforeEach, describe, expect, it } from "bun:test";

const state = {
  calls: [] as Array<{ before: Date; limit: number }>,
  batchResults: [] as number[],
};

describe("runAgentJobLogsSweeperOnce", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/test";
    state.calls = [];
    state.batchResults = [];
  });

  it("deletes in batches until completion and applies guardrails", async () => {
    state.batchResults = [100, 40];
    const { runAgentJobLogsSweeperOnce } = await import("./agent-job-logs-sweeper");

    const result = await runAgentJobLogsSweeperOnce({
      retentionDays: 0,
      batchSize: 10,
    }, {
      deleteAgentJobLogsBeforeTimestamp: async (before: Date, limit: number) => {
        state.calls.push({ before, limit });
        return state.batchResults.shift() ?? 0;
      },
      logger: {
        info: () => {},
        error: () => {},
      },
    });

    expect(result.rowsDeleted).toBe(140);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(state.calls).toHaveLength(2);
    expect(state.calls[0]?.limit).toBe(100);
    expect(state.calls[1]?.limit).toBe(100);
  });
});
