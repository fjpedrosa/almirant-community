import { describe, expect, test } from "bun:test";
import { computeReleaseInsertion, type ColumnInfo } from "./add-release-column";

const col = (overrides: Partial<ColumnInfo>): ColumnInfo => ({
  id: "col-1",
  name: "Test",
  role: "other",
  order: 0,
  isDone: false,
  color: "#000000",
  ...overrides,
});

// ──────────────────────────────────────────────────────────
// computeReleaseInsertion
// ──────────────────────────────────────────────────────────

describe("computeReleaseInsertion - no validating column", () => {
  test("returns null when board has no validating column", () => {
    const plan = computeReleaseInsertion([
      col({ id: "a", role: "backlog", order: 0 }),
      col({ id: "b", role: "in_progress", order: 1 }),
      col({ id: "c", role: "done", order: 2, isDone: true }),
    ]);
    expect(plan).toBeNull();
  });
});

describe("computeReleaseInsertion - already has release", () => {
  test("returns null when board already has a release column (idempotent)", () => {
    const plan = computeReleaseInsertion([
      col({ id: "a", role: "validating", order: 5 }),
      col({ id: "b", role: "release", order: 6 }),
      col({ id: "c", role: "done", order: 7, isDone: true }),
    ]);
    expect(plan).toBeNull();
  });
});

describe("computeReleaseInsertion - validating + done present, no release", () => {
  test("inserts release at done's order and shifts done +1", () => {
    const plan = computeReleaseInsertion([
      col({ id: "backlog", role: "backlog", order: 0 }),
      col({ id: "in_progress", role: "in_progress", order: 1 }),
      col({ id: "review", role: "review", order: 2 }),
      col({ id: "validating", role: "validating", order: 3 }),
      col({ id: "done", role: "done", order: 4, isDone: true }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.insert.role).toBe("release");
    expect(plan!.insert.order).toBe(4);
    expect(plan!.insert.name).toBe("To Release");
    expect(plan!.insert.isDone).toBe(false);
    // Done shifts from 4 → 5
    expect(plan!.updates).toContainEqual({ id: "done", order: 5 });
  });

  test("shifts every column at or after done", () => {
    const plan = computeReleaseInsertion([
      col({ id: "validating", role: "validating", order: 5 }),
      col({ id: "to_doc", role: "to_document", order: 6 }),
      col({ id: "done", role: "done", order: 7, isDone: true }),
    ]);
    expect(plan).not.toBeNull();
    // The order chosen for the new release column: 7 (where done was)
    // Wait — the design says release goes BETWEEN validating and done.
    // If "done" is the first done-flagged column, release takes its order
    // and everything from there shifts +1. But to_document at order 6 is
    // BEFORE done — should NOT shift.
    expect(plan!.insert.order).toBe(7);
    const updateIds = plan!.updates.map((u) => u.id);
    expect(updateIds).toContain("done");
    expect(updateIds).not.toContain("to_doc");
  });
});

describe("computeReleaseInsertion - validating without done", () => {
  test("inserts release right after validating when no done column exists", () => {
    const plan = computeReleaseInsertion([
      col({ id: "backlog", role: "backlog", order: 0 }),
      col({ id: "validating", role: "validating", order: 1 }),
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.insert.order).toBe(2);
    // Nothing to shift.
    expect(plan!.updates).toEqual([]);
  });
});

describe("computeReleaseInsertion - color and metadata", () => {
  test("sets color #a855f7 and name 'To Release'", () => {
    const plan = computeReleaseInsertion([
      col({ id: "validating", role: "validating", order: 0 }),
      col({ id: "done", role: "done", order: 1, isDone: true }),
    ]);
    expect(plan!.insert.color).toBe("#a855f7");
    expect(plan!.insert.name).toBe("To Release");
  });
});
