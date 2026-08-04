import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repository = readFileSync(resolve(import.meta.dir, "work-item-repository.ts"), "utf8");
const mcp = readFileSync(
  resolve(import.meta.dir, "../../../../../api/src/mcp/tools/skill-context.tools.ts"),
  "utf8",
);

describe("archived work-item visibility", () => {
  test("filters archived rows from direct lookups and relation hydration", () => {
    expect(repository).toContain("eq(workItems.id, id), isNull(workItems.archivedAt)");
    expect(repository).toContain("inArray(workItems.id, uniqueIds), isNull(workItems.archivedAt)");
    expect(repository).toContain("inArray(workItems.parentId, itemIds), isNull(workItems.archivedAt)");
    expect(repository).toContain("getWorkItemHierarchy");
    expect(repository).toContain("isNull(workItems.archivedAt)");
  });

  test("keeps hierarchy traversal and MCP context on repository-filtered reads", () => {
    expect(repository).toContain('wi.archived_at IS NULL');
    expect(repository).toContain('child.archived_at IS NULL');
    expect(repository).toContain('c.archived_at IS NULL');
    expect(mcp).toContain("getWorkItemHierarchy");
    expect(mcp).toContain("getWorkItemsByIds");
    expect(mcp).toContain("getWorkItemsByTaskIds");
  });
});
