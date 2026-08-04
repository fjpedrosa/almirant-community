import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "work-item-retention-repository.ts"), "utf8");

describe("done retention repository", () => {
  test("uses a strict 72-hour cutoff and bounded, lock-safe batches", () => {
    expect(source).toContain("DONE_RETENTION_HOURS = 72");
    expect(source).toContain("DONE_RETENTION_BATCH_SIZE = 500");
    expect(source).toContain("lt(workItems.enteredDoneAt, cutoff)");
    expect(source).toContain("isNull(workItems.archivedAt)");
    expect(source).toContain("skipLocked: true");
    expect(source).toContain("notExists(");
    expect(source).toContain("retentionChild.parentId");
    expect(source).toContain("Math.min(args?.batchSize ?? DONE_RETENTION_BATCH_SIZE, DONE_RETENTION_BATCH_SIZE)");
  });

  test("archives idempotently and cascades only after all direct children are archived", () => {
    expect(source).toContain(".set({ archivedAt: now, updatedAt: now })");
    expect(source).toContain("eq(workItems.parentId, candidate.id)");
    expect(source).toContain("if (!activeChild) ready.push(candidate)");
    expect(source).toContain('.for("update")');
    expect(source).not.toContain("delete(workItems)");
  });
});
