/**
 * Unit tests for hierarchy-utils.ts
 *
 * Tests for A-1029: filterToTopmostItems logic
 * Tests for A-1030: computeChildrenToMove, progress calculation, column distribution
 */
import { describe, it, expect } from "bun:test";
import {
  filterToTopmostItems,
  buildGroupsBy,
  buildHierarchyGroups,
  flattenSingleChildChains,
  flattenTreeToRenderList,
  collectAllGroupKeysFromItems,
  getTopmostAncestor,
  buildTopmostNodeProjection,
  computeChildrenToMove,
  topmostProjectionToGroups,
} from "./hierarchy-utils";
import type { BoardColumn } from "@/domains/boards/domain/types";
import type { WorkItemWithContext, ChildrenSummary } from "./types";

const createMockColumn = (
  id: string,
  name: string,
  order: number,
): BoardColumn => ({
  id,
  boardId: "board-1",
  name,
  color: "#111827",
  order,
  role: "todo",
  isDone: false,
  createdAt: new Date(),
  updatedAt: new Date(),
});

// Helper to create minimal WorkItemWithContext objects
const createMockItem = (
  id: string,
  overrides: Partial<WorkItemWithContext> = {}
): WorkItemWithContext => ({
  id,
  projectId: null,
  boardId: "board-1",
  boardColumnId: "col-1",
  parentId: null,
  type: "task",
  title: `Item ${id}`,
  description: null,
  priority: "medium",
  assignee: null,
  position: 0,
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  metadata: {},
  isAiProcessing: false,
  taskId: `T-${id}`,
  createdByUserId: null,
  requestedByUserId: null,
  codingAgent: null,
  aiModel: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  tags: [],
  assignees: [],
  childrenCount: 0,
  parentTitle: null,
  parentType: null,
  parentTaskId: null,
  createdBy: null,
  projectName: null,
  projectColor: null,
  isVirtualColumn: false,
  ...overrides,
});

describe("filterToTopmostItems (A-1029)", () => {
  it("should preserve standalone items (items without parentId)", () => {
    // Arrange
    const columns = [
      {
        column: createMockColumn("col-1", "Todo", 0),
        items: [
          createMockItem("item-1"),
          createMockItem("item-2"),
        ],
        count: 2,
      },
    ];

    // Act
    const result = filterToTopmostItems(columns);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0].items).toHaveLength(2);
    expect(result[0].items.map(i => i.id)).toEqual(["item-1", "item-2"]);
  });

  it("should filter out child items whose parent is in the same board", () => {
    // Arrange: parent-1 is in the board, child-1 has parent-1 as parentId
    const columns = [
      {
        column: createMockColumn("col-1", "Todo", 0),
        items: [
          createMockItem("parent-1", { type: "story" }),
          createMockItem("child-1", { parentId: "parent-1" }),
        ],
        count: 2,
      },
    ];

    // Act
    const result = filterToTopmostItems(columns);

    // Assert: child-1 should be filtered out
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].id).toBe("parent-1");
    expect(result[0].count).toBe(1);
  });

  it("should preserve items whose parent is NOT in the board", () => {
    // Arrange: child-1 has parentId pointing to an item NOT in any column
    const columns = [
      {
        column: createMockColumn("col-1", "Todo", 0),
        items: [
          createMockItem("child-1", { parentId: "external-parent" }),
        ],
        count: 1,
      },
    ];

    // Act
    const result = filterToTopmostItems(columns);

    // Assert: child-1 should be preserved (parent not in board)
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].id).toBe("child-1");
  });

  it("should handle multiple columns with mixed items", () => {
    // Arrange
    const columns = [
      {
        column: createMockColumn("col-1", "Todo", 0),
        items: [
          createMockItem("parent-1"),
          createMockItem("child-1", { parentId: "parent-1" }),
        ],
        count: 2,
      },
      {
        column: createMockColumn("col-2", "Done", 1),
        items: [
          createMockItem("standalone"),
          createMockItem("child-2", { parentId: "parent-1" }),
        ],
        count: 2,
      },
    ];

    // Act
    const result = filterToTopmostItems(columns);

    // Assert
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].id).toBe("parent-1");
    expect(result[0].count).toBe(1);

    expect(result[1].items).toHaveLength(1);
    expect(result[1].items[0].id).toBe("standalone");
    expect(result[1].count).toBe(1);
  });

  it("should handle empty columns", () => {
    // Arrange
    const columns = [
      {
        column: createMockColumn("col-1", "Empty", 0),
        items: [],
        count: 0,
      },
    ];

    // Act
    const result = filterToTopmostItems(columns);

    // Assert
    expect(result[0].items).toHaveLength(0);
    expect(result[0].count).toBe(0);
  });

  it("should handle deeply nested children (only direct children of present parents are filtered)", () => {
    // Arrange: grandparent -> parent -> child
    // parent's parentId is grandparent which IS in the board -> filtered
    // child's parentId is parent which IS in the board -> filtered
    const columns = [
      {
        column: createMockColumn("col-1", "Todo", 0),
        items: [
          createMockItem("grandparent", { type: "epic" }),
          createMockItem("parent", { type: "feature", parentId: "grandparent" }),
          createMockItem("child", { type: "task", parentId: "parent" }),
        ],
        count: 3,
      },
    ];

    // Act
    const result = filterToTopmostItems(columns);

    // Assert: only grandparent (the topmost) should remain
    expect(result[0].items).toHaveLength(1);
    expect(result[0].items[0].id).toBe("grandparent");
  });
});

describe("computeChildrenToMove (A-1030)", () => {
  const columns = [
    { id: "backlog", order: 0 },
    { id: "todo", order: 1 },
    { id: "in-progress", order: 2 },
    { id: "done", order: 3 },
  ];

  it("should return empty array when target column not found", () => {
    const childrenSummary: ChildrenSummary = {
      totalLeafCount: 2,
      doneCount: 0,
      progressPercent: 0,
      countPerColumn: { backlog: 1, todo: 1 },
      leafIdsByColumn: { backlog: ["a"], todo: ["b"] },
    };

    const result = computeChildrenToMove(childrenSummary, "unknown-col", columns);
    expect(result).toEqual([]);
  });

  it("should return all children in columns with order < target", () => {
    const childrenSummary: ChildrenSummary = {
      totalLeafCount: 4,
      doneCount: 0,
      progressPercent: 0,
      countPerColumn: { backlog: 1, todo: 2, "in-progress": 1 },
      leafIdsByColumn: {
        backlog: ["item-1"],
        todo: ["item-2", "item-3"],
        "in-progress": ["item-4"],
      },
    };

    // Move to "done" (order 3) -> should include backlog (0), todo (1), in-progress (2)
    const result = computeChildrenToMove(childrenSummary, "done", columns);
    expect(result).toHaveLength(4);
    expect(result).toContain("item-1");
    expect(result).toContain("item-2");
    expect(result).toContain("item-3");
    expect(result).toContain("item-4");
  });

  it("should exclude children already in columns >= target order", () => {
    const childrenSummary: ChildrenSummary = {
      totalLeafCount: 3,
      doneCount: 1,
      progressPercent: 33,
      countPerColumn: { backlog: 1, "in-progress": 1, done: 1 },
      leafIdsByColumn: {
        backlog: ["item-1"],
        "in-progress": ["item-2"],
        done: ["item-3"],
      },
    };

    // Move to "in-progress" (order 2) -> only backlog (0) and todo (1) qualify
    const result = computeChildrenToMove(childrenSummary, "in-progress", columns);
    expect(result).toHaveLength(1);
    expect(result).toContain("item-1");
    expect(result).not.toContain("item-2"); // already at in-progress
    expect(result).not.toContain("item-3"); // already at done
  });

  it("should return empty when all children are in columns >= target", () => {
    const childrenSummary: ChildrenSummary = {
      totalLeafCount: 2,
      doneCount: 2,
      progressPercent: 100,
      countPerColumn: { done: 2 },
      leafIdsByColumn: { done: ["item-1", "item-2"] },
    };

    const result = computeChildrenToMove(childrenSummary, "done", columns);
    expect(result).toEqual([]);
  });

  it("should handle parents with no children", () => {
    const childrenSummary: ChildrenSummary = {
      totalLeafCount: 0,
      doneCount: 0,
      progressPercent: 0,
      countPerColumn: {},
      leafIdsByColumn: {},
    };

    const result = computeChildrenToMove(childrenSummary, "done", columns);
    expect(result).toEqual([]);
  });
});

describe("buildTopmostNodeProjection (A-1030)", () => {
  it("should group items by their topmost ancestor", () => {
    const items = [
      createMockItem("task-1", {
        boardColumnId: "col-1",
        ancestors: [
          { id: "story-1", title: "Story 1", type: "story", taskId: "S-1" },
          { id: "epic-1", title: "Epic 1", type: "epic", taskId: "E-1" },
        ],
      }),
      createMockItem("task-2", {
        boardColumnId: "col-2",
        ancestors: [
          { id: "story-1", title: "Story 1", type: "story", taskId: "S-1" },
          { id: "epic-1", title: "Epic 1", type: "epic", taskId: "E-1" },
        ],
      }),
    ];

    const result = buildTopmostNodeProjection(items);

    expect(result).toHaveLength(1);
    expect(result[0].rootAncestor.id).toBe("epic-1");
    expect(result[0].totalCount).toBe(2);
    expect(result[0].leafItems).toHaveLength(2);
  });

  it("should treat items without ancestors as their own root", () => {
    const items = [
      createMockItem("standalone-1", { boardColumnId: "col-1" }),
      createMockItem("standalone-2", { boardColumnId: "col-2" }),
    ];

    const result = buildTopmostNodeProjection(items);

    expect(result).toHaveLength(2);
    expect(result.find(p => p.rootAncestor.id === "standalone-1")).toBeDefined();
    expect(result.find(p => p.rootAncestor.id === "standalone-2")).toBeDefined();
  });

  it("should compute column distribution correctly", () => {
    const items = [
      createMockItem("task-1", {
        boardColumnId: "col-done",
        ancestors: [{ id: "epic-1", title: "Epic", type: "epic", taskId: "E-1" }],
      }),
      createMockItem("task-2", {
        boardColumnId: "col-done",
        ancestors: [{ id: "epic-1", title: "Epic", type: "epic", taskId: "E-1" }],
      }),
      createMockItem("task-3", {
        boardColumnId: "col-todo",
        ancestors: [{ id: "epic-1", title: "Epic", type: "epic", taskId: "E-1" }],
      }),
    ];

    const result = buildTopmostNodeProjection(items);

    expect(result).toHaveLength(1);
    expect(result[0].columnDistribution["col-done"]).toBe(2);
    expect(result[0].columnDistribution["col-todo"]).toBe(1);
    expect(result[0].totalCount).toBe(3);
  });

  it("should handle items with null boardColumnId", () => {
    const items = [
      createMockItem("task-1", {
        boardColumnId: null,
        ancestors: [{ id: "epic-1", title: "Epic", type: "epic", taskId: "E-1" }],
      }),
    ];

    const result = buildTopmostNodeProjection(items);

    expect(result).toHaveLength(1);
    expect(result[0].columnDistribution["__none__"]).toBe(1);
  });
});

describe("buildGroupsBy", () => {
  it("should group items by direct parent", () => {
    const items = [
      createMockItem("task-1", {
        ancestors: [{ id: "parent-1", title: "Parent 1", type: "story", taskId: "S-1" }],
      }),
      createMockItem("task-2", {
        ancestors: [{ id: "parent-1", title: "Parent 1", type: "story", taskId: "S-1" }],
      }),
      createMockItem("task-3", {
        ancestors: [{ id: "parent-2", title: "Parent 2", type: "story", taskId: "S-2" }],
      }),
    ];

    const groups = buildGroupsBy(items, "parent");

    expect(groups).toHaveLength(2);
    const group1 = groups.find(g => g.ancestor?.id === "parent-1");
    const group2 = groups.find(g => g.ancestor?.id === "parent-2");
    expect(group1?.items).toHaveLength(2);
    expect(group2?.items).toHaveLength(1);
  });

  it("should create ungrouped bucket for items without ancestors", () => {
    const items = [
      createMockItem("task-1"), // no ancestors
      createMockItem("task-2", {
        ancestors: [{ id: "parent-1", title: "Parent 1", type: "story", taskId: "S-1" }],
      }),
    ];

    const groups = buildGroupsBy(items, "parent");

    expect(groups).toHaveLength(2);
    const ungrouped = groups.find(g => g.ancestor === null);
    expect(ungrouped?.items).toHaveLength(1);
    expect(ungrouped?.items[0].id).toBe("task-1");
  });

  it("should group by epic type when groupBy is epic", () => {
    const items = [
      createMockItem("task-1", {
        ancestors: [
          { id: "story-1", title: "Story 1", type: "story", taskId: "S-1" },
          { id: "epic-1", title: "Epic 1", type: "epic", taskId: "E-1" },
        ],
      }),
    ];

    const groups = buildGroupsBy(items, "epic");

    expect(groups).toHaveLength(1);
    expect(groups[0].ancestor?.id).toBe("epic-1");
    expect(groups[0].ancestor?.type).toBe("epic");
  });
});

describe("buildHierarchyGroups", () => {
  it("should build nested hierarchy from ancestors", () => {
    const items = [
      createMockItem("task-1", {
        ancestors: [
          { id: "story-1", title: "Story", type: "story", taskId: "S-1" },
          { id: "epic-1", title: "Epic", type: "epic", taskId: "E-1" },
        ],
      }),
    ];

    const roots = buildHierarchyGroups(items);

    expect(roots).toHaveLength(1);
    expect(roots[0].ancestor?.id).toBe("epic-1");
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].ancestor?.id).toBe("story-1");
    expect(roots[0].children[0].items).toHaveLength(1);
  });

  it("should compute totalItemCount bottom-up", () => {
    const items = [
      createMockItem("task-1", {
        ancestors: [
          { id: "story-1", title: "Story", type: "story", taskId: "S-1" },
        ],
      }),
      createMockItem("task-2", {
        ancestors: [
          { id: "story-1", title: "Story", type: "story", taskId: "S-1" },
        ],
      }),
    ];

    const roots = buildHierarchyGroups(items);

    expect(roots[0].totalItemCount).toBe(2);
  });
});

describe("flattenSingleChildChains", () => {
  it("should collapse single-child chains", () => {
    // Create a chain: root -> intermediate -> leaf (with items)
    const nodes = [
      {
        ancestor: { id: "root", title: "Root", type: "epic" as const, taskId: "E-1" },
        depth: 0,
        children: [
          {
            ancestor: { id: "intermediate", title: "Intermediate", type: "feature" as const, taskId: "F-1" },
            depth: 1,
            children: [],
            items: [createMockItem("task-1")],
            totalItemCount: 1,
          },
        ],
        items: [],
        totalItemCount: 1,
      },
    ];

    const flattened = flattenSingleChildChains(nodes);

    // Root (0 items) with single child -> should collapse to intermediate
    expect(flattened).toHaveLength(1);
    expect(flattened[0].ancestor?.id).toBe("intermediate");
  });

  it("should not collapse nodes with multiple children", () => {
    const nodes = [
      {
        ancestor: { id: "root", title: "Root", type: "epic" as const, taskId: "E-1" },
        depth: 0,
        children: [
          {
            ancestor: { id: "child-1", title: "Child 1", type: "feature" as const, taskId: "F-1" },
            depth: 1,
            children: [],
            items: [createMockItem("task-1")],
            totalItemCount: 1,
          },
          {
            ancestor: { id: "child-2", title: "Child 2", type: "feature" as const, taskId: "F-2" },
            depth: 1,
            children: [],
            items: [createMockItem("task-2")],
            totalItemCount: 1,
          },
        ],
        items: [],
        totalItemCount: 2,
      },
    ];

    const flattened = flattenSingleChildChains(nodes);

    expect(flattened).toHaveLength(1);
    expect(flattened[0].ancestor?.id).toBe("root");
    expect(flattened[0].children).toHaveLength(2);
  });
});

describe("collectAllGroupKeysFromItems", () => {
  it("should collect all ancestor IDs as group keys", () => {
    const items = [
      createMockItem("task-1", {
        ancestors: [
          { id: "story-1", title: "Story", type: "story", taskId: "S-1" },
          { id: "epic-1", title: "Epic", type: "epic", taskId: "E-1" },
        ],
      }),
      createMockItem("task-2", {
        ancestors: [
          { id: "story-2", title: "Story 2", type: "story", taskId: "S-2" },
        ],
      }),
    ];

    const keys = collectAllGroupKeysFromItems(items);

    expect(keys.has("story-1")).toBe(true);
    expect(keys.has("epic-1")).toBe(true);
    expect(keys.has("story-2")).toBe(true);
  });

  it("should include __ungrouped__ when items have no ancestors", () => {
    const items = [
      createMockItem("task-1"), // no ancestors
    ];

    const keys = collectAllGroupKeysFromItems(items);

    expect(keys.has("__ungrouped__")).toBe(true);
  });
});

describe("getTopmostAncestor", () => {
  it("should return null for items without ancestors", () => {
    const item = createMockItem("task-1");
    expect(getTopmostAncestor(item)).toBeNull();
  });

  it("should return the last ancestor (root) from ancestors array", () => {
    const item = createMockItem("task-1", {
      ancestors: [
        { id: "parent", title: "Parent", type: "story", taskId: "S-1" },
        { id: "grandparent", title: "Grandparent", type: "epic", taskId: "E-1" },
      ],
    });

    const topmost = getTopmostAncestor(item);

    expect(topmost?.id).toBe("grandparent");
    expect(topmost?.type).toBe("epic");
  });
});

describe("topmostProjectionToGroups", () => {
  it("should convert projections to HierarchyGroupNode format", () => {
    const projections = [
      {
        rootAncestor: { id: "epic-1", title: "Epic 1", type: "epic" as const, taskId: "E-1" },
        leafItems: [createMockItem("task-1"), createMockItem("task-2")],
        totalCount: 2,
        completedCount: 1,
        columnDistribution: { "col-1": 1, "col-2": 1 },
      },
    ];

    const groups = topmostProjectionToGroups(projections);

    expect(groups).toHaveLength(1);
    expect(groups[0].ancestor?.id).toBe("epic-1");
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].totalItemCount).toBe(2);
    expect(groups[0].depth).toBe(0);
    expect(groups[0].children).toHaveLength(0);
  });
});

describe("flattenTreeToRenderList", () => {
  it("should produce flat render list with group headers and items", () => {
    const nodes = [
      {
        ancestor: { id: "group-1", title: "Group 1", type: "story" as const, taskId: "S-1" },
        depth: 0,
        children: [],
        items: [createMockItem("task-1"), createMockItem("task-2")],
        totalItemCount: 2,
      },
    ];

    const result = flattenTreeToRenderList(nodes, new Set());

    expect(result).toHaveLength(3); // 1 header + 2 items
    expect(result[0].kind).toBe("group-header");
    expect(result[1].kind).toBe("work-item");
    expect(result[2].kind).toBe("work-item");
  });

  it("should skip items in collapsed groups", () => {
    const nodes = [
      {
        ancestor: { id: "group-1", title: "Group 1", type: "story" as const, taskId: "S-1" },
        depth: 0,
        children: [],
        items: [createMockItem("task-1")],
        totalItemCount: 1,
      },
    ];

    const result = flattenTreeToRenderList(nodes, new Set(["group-1"]));

    expect(result).toHaveLength(1); // only header, items collapsed
    expect(result[0].kind).toBe("group-header");
  });
});
