import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreRealModules } from "../../../../test/mocks";

const createWorkItem = mock(async (_workspaceId: string, data: { tempId?: string; title: string; parentId?: string; boardColumnId?: string | null }) => ({
  id: `real-${data.title}`,
  title: data.title,
}));
const addDependency = mock(async () => ({ id: "dependency-1" }));
const db = { transaction: async <T>(callback: (tx: unknown) => Promise<T>) => callback({}) };

mock.module("@almirant/database", () => ({
  addDependency,
  createWorkItem,
  db,
  isLeafType: (type: string) => type === "task" || type === "idea",
}));
mock.module("@almirant/config", () => ({ logger: { error: mock(() => undefined) } }));

const { aiWorkItemsPayloadSchema, generateWorkItems } = await import("./work-item-generator");

describe("work-item generator", () => {
  beforeEach(() => {
    createWorkItem.mockClear();
    addDependency.mockClear();
  });

  test("accepts Community hierarchy types and creates dependency edges after items", async () => {
    const result = await generateWorkItems({
      workspaceId: "workspace-1",
      projectId: "project-1",
      boardId: "board-1",
      boardColumnId: "column-1",
      items: [
        { tempId: "epic-1", type: "epic", title: "Epic", priority: "medium" },
        { tempId: "feature-1", type: "feature", title: "Feature", priority: "medium", parentTempId: "epic-1" },
        { tempId: "task-1", type: "task", title: "Task", priority: "high", parentTempId: "feature-1" },
      ],
      dependencies: [{ blockedTempId: "task-1", blockedByTempId: "feature-1" }],
    });

    expect(result.errors).toEqual([]);
    expect(result.dependenciesCreated).toBe(1);
    expect(addDependency).toHaveBeenCalledTimes(1);
    expect(createWorkItem).toHaveBeenCalledTimes(3);
    expect(createWorkItem.mock.calls.every((call) => call[1]?.boardColumnId === "column-1")).toBe(true);
  });

  test("rejects duplicate and unknown dependency references before persistence", () => {
    expect(() => aiWorkItemsPayloadSchema.parse({
      items: [{ tempId: "task-1", type: "task", title: "Task", priority: "medium" }, { tempId: "task-1", type: "task", title: "Duplicate", priority: "medium" }],
      dependencies: [{ blockedTempId: "task-1", blockedByTempId: "missing" }],
    })).toThrow();
    expect(createWorkItem).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
