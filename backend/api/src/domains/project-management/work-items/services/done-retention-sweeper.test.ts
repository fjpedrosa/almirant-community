import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "done-retention-sweeper.ts"), "utf8");

describe("done retention sweeper", () => {
  test("runs on a 15-minute cadence with bounded retention settings", () => {
    expect(source).toContain("15 * 60 * 1000");
    expect(source).toContain("DONE_RETENTION_BATCH_SIZE");
    expect(source).toContain("archiveDoneWorkItems");
  });

  test("groups invalidations by workspace instead of broadcasting per item", () => {
    expect(source).toContain("groupArchivedItemsByWorkspace");
    expect(source).toContain("new Map<string, ArchivedDoneWorkItem[]>");
    expect(source).toContain("items.map((item) => item.id)");
    expect(source).toContain("new Set(items.map((item) => item.boardId))");
    expect(source).toContain('type: "work-items:invalidated"');
    expect(source).not.toContain('type: "work-item:updated"');
  });
});
