/**
 * Unit tests for virtual column computation logic (A-1028)
 *
 * Tests the pure computation logic for childrenSummary and virtual column assignment.
 * This tests the algorithm independently of database queries.
 */
import { describe, it, expect } from "bun:test";
import type { ChildrenSummary } from "./types";

// Pure computation functions extracted from computeVirtualColumns logic

interface LeafEntry {
  columnId: string;
  itemId: string;
}

interface ColumnInfo {
  id: string;
  order: number;
  role: string;
  isDone: boolean;
}

/**
 * Computes the ChildrenSummary for a parent item given its leaf entries.
 * This is the pure computation portion of computeVirtualColumns.
 */
function computeChildrenSummaryForParent(
  leafEntries: LeafEntry[],
  columnIsDoneMap: Map<string, boolean>
): ChildrenSummary {
  const countPerColumn: Record<string, number> = {};
  const leafIdsByColumn: Record<string, string[]> = {};
  let doneCount = 0;

  for (const entry of leafEntries) {
    countPerColumn[entry.columnId] = (countPerColumn[entry.columnId] ?? 0) + 1;
    if (!leafIdsByColumn[entry.columnId]) {
      leafIdsByColumn[entry.columnId] = [];
    }
    leafIdsByColumn[entry.columnId].push(entry.itemId);
    if (columnIsDoneMap.get(entry.columnId) === true) {
      doneCount++;
    }
  }

  const totalLeafCount = leafEntries.length;
  const progressPercent = totalLeafCount > 0 ? Math.round((doneCount / totalLeafCount) * 100) : 0;

  return {
    totalLeafCount,
    doneCount,
    progressPercent,
    countPerColumn,
    leafIdsByColumn,
  };
}

/**
 * Computes the virtual column ID for a parent item based on its leaf entries.
 */
function computeVirtualColumnForParent(
  leafEntries: LeafEntry[],
  columns: ColumnInfo[]
): string | null {
  if (leafEntries.length === 0) {
    // No leaf descendants -> backlog
    const backlogColumn = columns.find((c) => c.role === "backlog") ?? columns[0];
    return backlogColumn?.id ?? null;
  }

  const columnOrder = new Map(columns.map((c) => [c.id, c.order]));
  const columnIsDone = new Map(columns.map((c) => [c.id, c.isDone]));
  const leafColumnIds = leafEntries.map((e) => e.columnId);

  // Check if ALL leaves are in a done column
  const allDone = leafColumnIds.every((cId) => columnIsDone.get(cId) === true);
  if (allDone) {
    const doneColumn = columns.find((c) => c.isDone);
    return doneColumn?.id ?? null;
  }

  // Find the least advanced leaf (lowest column order)
  const backlogColumn = columns.find((c) => c.role === "backlog") ?? columns[0];
  let minOrder = Infinity;
  let minColumnId = backlogColumn?.id ?? null;

  for (const cId of leafColumnIds) {
    const order = columnOrder.get(cId);
    if (order !== undefined && order < minOrder) {
      minOrder = order;
      minColumnId = cId;
    }
  }

  return minColumnId;
}

describe("computeChildrenSummaryForParent (A-1028)", () => {
  const columns: ColumnInfo[] = [
    { id: "backlog", order: 0, role: "backlog", isDone: false },
    { id: "todo", order: 1, role: "todo", isDone: false },
    { id: "in-progress", order: 2, role: "in_progress", isDone: false },
    { id: "done", order: 3, role: "done", isDone: true },
  ];

  const columnIsDoneMap = new Map(columns.map((c) => [c.id, c.isDone]));

  it("should compute correct totalLeafCount", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "backlog", itemId: "item-1" },
      { columnId: "todo", itemId: "item-2" },
      { columnId: "done", itemId: "item-3" },
    ];

    const summary = computeChildrenSummaryForParent(leafEntries, columnIsDoneMap);

    expect(summary.totalLeafCount).toBe(3);
  });

  it("should compute correct doneCount", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "backlog", itemId: "item-1" },
      { columnId: "done", itemId: "item-2" },
      { columnId: "done", itemId: "item-3" },
    ];

    const summary = computeChildrenSummaryForParent(leafEntries, columnIsDoneMap);

    expect(summary.doneCount).toBe(2);
  });

  it("should compute correct progressPercent", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "backlog", itemId: "item-1" },
      { columnId: "done", itemId: "item-2" },
    ];

    const summary = computeChildrenSummaryForParent(leafEntries, columnIsDoneMap);

    expect(summary.progressPercent).toBe(50); // 1 done out of 2
  });

  it("should compute progressPercent as 0 when no leaves", () => {
    const summary = computeChildrenSummaryForParent([], columnIsDoneMap);

    expect(summary.progressPercent).toBe(0);
    expect(summary.totalLeafCount).toBe(0);
    expect(summary.doneCount).toBe(0);
  });

  it("should compute progressPercent as 100 when all done", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "done", itemId: "item-1" },
      { columnId: "done", itemId: "item-2" },
    ];

    const summary = computeChildrenSummaryForParent(leafEntries, columnIsDoneMap);

    expect(summary.progressPercent).toBe(100);
    expect(summary.doneCount).toBe(2);
  });

  it("should compute correct countPerColumn mapping", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "backlog", itemId: "item-1" },
      { columnId: "backlog", itemId: "item-2" },
      { columnId: "todo", itemId: "item-3" },
      { columnId: "done", itemId: "item-4" },
    ];

    const summary = computeChildrenSummaryForParent(leafEntries, columnIsDoneMap);

    expect(summary.countPerColumn["backlog"]).toBe(2);
    expect(summary.countPerColumn["todo"]).toBe(1);
    expect(summary.countPerColumn["done"]).toBe(1);
    expect(summary.countPerColumn["in-progress"]).toBeUndefined();
  });

  it("should compute correct leafIdsByColumn mapping", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "backlog", itemId: "item-1" },
      { columnId: "backlog", itemId: "item-2" },
      { columnId: "todo", itemId: "item-3" },
    ];

    const summary = computeChildrenSummaryForParent(leafEntries, columnIsDoneMap);

    expect(summary.leafIdsByColumn["backlog"]).toEqual(["item-1", "item-2"]);
    expect(summary.leafIdsByColumn["todo"]).toEqual(["item-3"]);
    expect(summary.leafIdsByColumn["in-progress"]).toBeUndefined();
  });

  it("should return empty mappings for parents without children", () => {
    const summary = computeChildrenSummaryForParent([], columnIsDoneMap);

    expect(summary.countPerColumn).toEqual({});
    expect(summary.leafIdsByColumn).toEqual({});
  });
});

describe("computeVirtualColumnForParent (A-1028)", () => {
  const columns: ColumnInfo[] = [
    { id: "backlog", order: 0, role: "backlog", isDone: false },
    { id: "todo", order: 1, role: "todo", isDone: false },
    { id: "in-progress", order: 2, role: "in_progress", isDone: false },
    { id: "done", order: 3, role: "done", isDone: true },
  ];

  it("should return backlog column when parent has no children", () => {
    const result = computeVirtualColumnForParent([], columns);

    expect(result).toBe("backlog");
  });

  it("should return done column when all leaves are done", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "done", itemId: "item-1" },
      { columnId: "done", itemId: "item-2" },
    ];

    const result = computeVirtualColumnForParent(leafEntries, columns);

    expect(result).toBe("done");
  });

  it("should return least advanced column when leaves are mixed", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "in-progress", itemId: "item-1" },
      { columnId: "done", itemId: "item-2" },
    ];

    const result = computeVirtualColumnForParent(leafEntries, columns);

    // "in-progress" has order 2, which is less than "done" order 3
    expect(result).toBe("in-progress");
  });

  it("should return backlog when one leaf is in backlog", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "backlog", itemId: "item-1" },
      { columnId: "done", itemId: "item-2" },
      { columnId: "in-progress", itemId: "item-3" },
    ];

    const result = computeVirtualColumnForParent(leafEntries, columns);

    expect(result).toBe("backlog");
  });

  it("should handle single leaf item", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "todo", itemId: "item-1" },
    ];

    const result = computeVirtualColumnForParent(leafEntries, columns);

    expect(result).toBe("todo");
  });

  it("should handle columns without backlog role", () => {
    const columnsNoBacklog: ColumnInfo[] = [
      { id: "todo", order: 0, role: "todo", isDone: false },
      { id: "done", order: 1, role: "done", isDone: true },
    ];

    // No leaves -> should fall back to first column
    const result = computeVirtualColumnForParent([], columnsNoBacklog);

    expect(result).toBe("todo");
  });

  it("should handle all leaves in same column", () => {
    const leafEntries: LeafEntry[] = [
      { columnId: "todo", itemId: "item-1" },
      { columnId: "todo", itemId: "item-2" },
      { columnId: "todo", itemId: "item-3" },
    ];

    const result = computeVirtualColumnForParent(leafEntries, columns);

    expect(result).toBe("todo");
  });
});

describe("childrenSummary integration (A-1028)", () => {
  it("should enable computing which children to move based on leafIdsByColumn", () => {
    const columns: ColumnInfo[] = [
      { id: "backlog", order: 0, role: "backlog", isDone: false },
      { id: "todo", order: 1, role: "todo", isDone: false },
      { id: "in-progress", order: 2, role: "in_progress", isDone: false },
      { id: "done", order: 3, role: "done", isDone: true },
    ];
    const columnIsDoneMap = new Map(columns.map((c) => [c.id, c.isDone]));

    const leafEntries: LeafEntry[] = [
      { columnId: "backlog", itemId: "item-1" },
      { columnId: "todo", itemId: "item-2" },
      { columnId: "in-progress", itemId: "item-3" },
      { columnId: "done", itemId: "item-4" },
    ];

    const summary = computeChildrenSummaryForParent(leafEntries, columnIsDoneMap);

    // Simulate dragging parent card to "in-progress" -> move items from less advanced columns
    const targetColumnOrder = 2; // in-progress
    const columnOrderMap = new Map(columns.map((c) => [c.id, c.order]));
    const idsToMove: string[] = [];

    for (const [colId, leafIds] of Object.entries(summary.leafIdsByColumn)) {
      const colOrder = columnOrderMap.get(colId);
      if (colOrder !== undefined && colOrder < targetColumnOrder) {
        idsToMove.push(...leafIds);
      }
    }

    // Should move items from backlog (0) and todo (1), not in-progress (2) or done (3)
    expect(idsToMove).toContain("item-1");
    expect(idsToMove).toContain("item-2");
    expect(idsToMove).not.toContain("item-3");
    expect(idsToMove).not.toContain("item-4");
  });
});
