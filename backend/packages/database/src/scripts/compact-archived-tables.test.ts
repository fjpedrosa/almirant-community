import { describe, expect, test } from "bun:test";
import {
  COMPACTABLE_TABLES,
  buildCompactionPlan,
  formatReclaimed,
} from "./compact-archived-tables";

describe("compaction plan", () => {
  test("only targets tables the retention sweepers purge from", () => {
    expect(COMPACTABLE_TABLES).toEqual(["agent_native_events", "session_events"]);
  });

  test("skips a table too small to be worth an exclusive lock", () => {
    const plan = buildCompactionPlan(
      [
        { table: "agent_native_events", totalBytes: 9_000_000_000, liveTuples: 100 },
        { table: "session_events", totalBytes: 50_000_000, liveTuples: 10 },
      ],
      { minimumTotalBytes: 100_000_000 },
    );

    expect(plan.map((entry) => entry.table)).toEqual(["agent_native_events"]);
  });

  // Regression: selecting on n_dead_tup skipped the 9 GB table entirely, because
  // autovacuum had already turned its dead tuples into reusable-but-allocated pages.
  test("selects a drained table that autovacuum has already marked clean", () => {
    const plan = buildCompactionPlan(
      [{ table: "agent_native_events", totalBytes: 9_000_000_000, liveTuples: 0 }],
      { minimumTotalBytes: 100_000_000 },
    );

    expect(plan.map((entry) => entry.table)).toEqual(["agent_native_events"]);
  });

  test("keeps the largest table first so an aborted run still frees the most", () => {
    const plan = buildCompactionPlan(
      [
        { table: "session_events", totalBytes: 2_000_000_000, liveTuples: 5 },
        { table: "agent_native_events", totalBytes: 9_000_000_000, liveTuples: 5 },
      ],
      { minimumTotalBytes: 1 },
    );

    expect(plan.map((entry) => entry.table)).toEqual([
      "agent_native_events",
      "session_events",
    ]);
  });

  test("refuses a table outside the allow-list", () => {
    expect(() =>
      buildCompactionPlan(
        [{ table: "users; DROP TABLE users", totalBytes: 1, liveTuples: 1 }],
        { minimumTotalBytes: 0 },
      ),
    ).toThrow(/not compactable/);
  });

  test("reports reclaimed space in human units", () => {
    expect(formatReclaimed(9_000_000_000, 700_000_000)).toBe("8.38 GB → 667.57 MB");
  });
});
