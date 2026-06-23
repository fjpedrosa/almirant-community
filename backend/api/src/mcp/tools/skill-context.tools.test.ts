import { describe, expect, it, spyOn, afterAll } from "bun:test";
import * as database from "@almirant/database";
import { makeWorkItem, makeBoard, testBoardColumn } from "../../test/fixtures";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const backlogColumn = {
  ...testBoardColumn,
  id: "col-backlog",
  name: "Backlog",
  order: 0,
  role: "backlog",
  isDone: false,
};

const todoColumn = {
  ...testBoardColumn,
  id: "col-todo",
  name: "To Do",
  order: 1,
  role: "todo",
  isDone: false,
};

const board = makeBoard({
  id: "board-1",
  projectId: "proj-test-1",
  organizationId: "org-test-1",
  columns: [backlogColumn, todoColumn],
});

// Work items representing different filter scenarios
const epicInBacklog = makeWorkItem({
  id: "epic-1",
  type: "epic",
  title: "Epic in Backlog",
  boardColumnId: null,
  parentId: null,
  boardId: "board-1",
  archivedAt: null,
  columnName: "Backlog",
  description: "An epic description",
});

const featureInBacklog = makeWorkItem({
  id: "feature-1",
  type: "feature",
  title: "Feature in Backlog",
  boardColumnId: null,
  parentId: null,
  boardId: "board-1",
  archivedAt: null,
  columnName: "Backlog",
  description: "A feature description",
});

const storyInBacklog = makeWorkItem({
  id: "story-1",
  type: "story",
  title: "Story in Backlog",
  boardColumnId: null,
  parentId: null,
  boardId: "board-1",
  archivedAt: null,
  columnName: "Backlog",
  description: "A story description",
});

const taskInBacklog = makeWorkItem({
  id: "task-backlog-1",
  type: "task",
  title: "Task in Backlog",
  boardColumnId: "col-backlog",
  parentId: null,
  boardId: "board-1",
  archivedAt: null,
  columnName: "Backlog",
  description: "A standalone task in backlog",
});

const taskWithParent = makeWorkItem({
  id: "task-child-1",
  type: "task",
  title: "Child Task in Backlog",
  boardColumnId: "col-backlog",
  parentId: "epic-1",
  boardId: "board-1",
  archivedAt: null,
  columnName: "Backlog",
  description: "A child task (should be excluded)",
});

const ideaItem = makeWorkItem({
  id: "idea-1",
  type: "idea",
  title: "Idea Item",
  boardColumnId: "col-backlog",
  parentId: null,
  boardId: "board-1",
  archivedAt: null,
  columnName: "Backlog",
  description: "An idea (should be excluded)",
});

const archivedTask = makeWorkItem({
  id: "task-archived-1",
  type: "task",
  title: "Archived Task",
  boardColumnId: "col-backlog",
  parentId: null,
  boardId: "board-1",
  archivedAt: new Date("2025-06-01"),
  columnName: "Backlog",
  description: "An archived task (should be excluded)",
});

const taskInTodo = makeWorkItem({
  id: "task-todo-1",
  type: "task",
  title: "Task in To Do",
  boardColumnId: "col-todo",
  parentId: null,
  boardId: "board-1",
  archivedAt: null,
  columnName: "To Do",
  description: "A task not in backlog (should be excluded from refinements)",
});

const allTestItems = [
  epicInBacklog,
  featureInBacklog,
  storyInBacklog,
  taskInBacklog,
  taskWithParent,
  ideaItem,
  archivedTask,
  taskInTodo,
];

// ---------------------------------------------------------------------------
// Spies
// ---------------------------------------------------------------------------

const getWorkItemsSpy = spyOn(database, "getWorkItems").mockImplementation(
  (async () => ({
    items: allTestItems,
    total: allTestItems.length,
  })) as never,
);

const getAllBoardsSpy = spyOn(database, "getAllBoards").mockImplementation(
  (async () => [board]) as never,
);

const computeVirtualColumnsSpy = spyOn(database, "computeVirtualColumns").mockImplementation(
  (async (itemIds: string[]) => {
    // Simulate that epic-1, feature-1, story-1 all resolve to backlog column
    const virtualColumnMap = new Map<string, string>();
    for (const id of itemIds) {
      if (id === "epic-1" || id === "feature-1" || id === "story-1") {
        virtualColumnMap.set(id, "col-backlog");
      }
    }
    return { virtualColumnMap };
  }) as never,
);

const getChildCountsByParentIdsSpy = spyOn(database, "getChildCountsByParentIds").mockImplementation(
  (async (parentIds: string[]) => {
    const map = new Map<string, number>();
    // epic-1 has 2 children, others have 0
    if (parentIds.includes("epic-1")) map.set("epic-1", 2);
    return map;
  }) as never,
);

// ---------------------------------------------------------------------------
// Types for the fake MCP server
// ---------------------------------------------------------------------------

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolHandler = (
  params: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<ToolResult>;

const withOrg = {
  authInfo: {
    extra: {
      organizationId: "org-test-1",
      projectId: "proj-test-1",
      userId: "user-test-1",
    },
  },
};

const buildToolsRegistry = async () => {
  const tools = new Map<string, ToolHandler>();

  const fakeServer = {
    tool: (
      name: string,
      _description: string,
      _schema: unknown,
      handler: ToolHandler,
    ) => {
      tools.set(name, handler);
      return undefined;
    },
  };

  const { registerSkillContextTools } = await import("./skill-context.tools");
  registerSkillContextTools(fakeServer as never);

  return tools;
};

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(() => {
  getWorkItemsSpy.mockRestore();
  getAllBoardsSpy.mockRestore();
  computeVirtualColumnsSpy.mockRestore();
  getChildCountsByParentIdsSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("get_ideation_context - potentialRefinements", () => {
  it("includes epic, feature, story, and standalone task in backlog", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("get_ideation_context");
    expect(handler).toBeDefined();

    const result = await handler!({ keywords: ["test"] }, withOrg);
    expect(result.isError).toBeUndefined();

    const payload = JSON.parse(result.content[0]!.text);
    const refinementIds = payload.potentialRefinements.map((r: { id: string }) => r.id);

    // Should include: epic-1, feature-1, story-1, task-backlog-1
    expect(refinementIds).toContain("epic-1");
    expect(refinementIds).toContain("feature-1");
    expect(refinementIds).toContain("story-1");
    expect(refinementIds).toContain("task-backlog-1");
  });

  it("excludes items with type=idea", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("get_ideation_context");

    const result = await handler!({ keywords: ["test"] }, withOrg);
    const payload = JSON.parse(result.content[0]!.text);
    const refinementIds = payload.potentialRefinements.map((r: { id: string }) => r.id);

    expect(refinementIds).not.toContain("idea-1");
  });

  it("excludes archived items", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("get_ideation_context");

    const result = await handler!({ keywords: ["test"] }, withOrg);
    const payload = JSON.parse(result.content[0]!.text);
    const refinementIds = payload.potentialRefinements.map((r: { id: string }) => r.id);

    expect(refinementIds).not.toContain("task-archived-1");
  });

  it("excludes tasks with a parentId (child tasks)", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("get_ideation_context");

    const result = await handler!({ keywords: ["test"] }, withOrg);
    const payload = JSON.parse(result.content[0]!.text);
    const refinementIds = payload.potentialRefinements.map((r: { id: string }) => r.id);

    expect(refinementIds).not.toContain("task-child-1");
  });

  it("excludes tasks not in backlog column", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("get_ideation_context");

    const result = await handler!({ keywords: ["test"] }, withOrg);
    const payload = JSON.parse(result.content[0]!.text);
    const refinementIds = payload.potentialRefinements.map((r: { id: string }) => r.id);

    expect(refinementIds).not.toContain("task-todo-1");
  });

  it("includes hasChildren and childCount fields", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("get_ideation_context");

    const result = await handler!({ keywords: ["test"] }, withOrg);
    const payload = JSON.parse(result.content[0]!.text);

    const epicRefinement = payload.potentialRefinements.find((r: { id: string }) => r.id === "epic-1");
    expect(epicRefinement).toBeDefined();
    expect(epicRefinement.hasChildren).toBe(true);
    expect(epicRefinement.childCount).toBe(2);

    const taskRefinement = payload.potentialRefinements.find((r: { id: string }) => r.id === "task-backlog-1");
    expect(taskRefinement).toBeDefined();
    expect(taskRefinement.hasChildren).toBe(false);
    expect(taskRefinement.childCount).toBe(0);
  });

  it("still returns potentialParents for backwards compatibility", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("get_ideation_context");

    const result = await handler!({ keywords: ["test"] }, withOrg);
    const payload = JSON.parse(result.content[0]!.text);

    // potentialParents should still be present and only contain epics/features
    expect(payload.potentialParents).toBeDefined();
    expect(Array.isArray(payload.potentialParents)).toBe(true);

    const parentTypes = payload.potentialParents.map((p: { type: string }) => p.type);
    for (const t of parentTypes) {
      expect(["epic", "feature"]).toContain(t);
    }

    // Should not contain story or task types
    expect(parentTypes).not.toContain("story");
    expect(parentTypes).not.toContain("task");
  });

  it("returns correct shape for each refinement item", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("get_ideation_context");

    const result = await handler!({ keywords: ["test"] }, withOrg);
    const payload = JSON.parse(result.content[0]!.text);

    for (const item of payload.potentialRefinements) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("taskId");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("type");
      expect(item).toHaveProperty("priority");
      expect(item).toHaveProperty("columnName");
      expect(item).toHaveProperty("descriptionExcerpt");
      expect(item).toHaveProperty("hasChildren");
      expect(item).toHaveProperty("childCount");
      expect(typeof item.hasChildren).toBe("boolean");
      expect(typeof item.childCount).toBe("number");
    }
  });
});

describe("hasDodHumanActionRequirement", () => {
  it("blocks DoD review context entries that require a human or external validator", async () => {
    const { hasDodHumanActionRequirement } = await import("./skill-context.tools");

    expect(hasDodHumanActionRequirement({ dod_human_action_required: true })).toBe(true);
    expect(hasDodHumanActionRequirement({ dod_human_review_required: true })).toBe(true);
    expect(hasDodHumanActionRequirement({ dod_auto_remediation_blocked: true })).toBe(true);
    expect(hasDodHumanActionRequirement({ dod_external_validation_required: true })).toBe(true);
    expect(hasDodHumanActionRequirement({ dod_external_validation_tools: ["Lighthouse"] })).toBe(true);
    expect(hasDodHumanActionRequirement({ dod_external_validation_tools: "Lighthouse, axe" })).toBe(true);
  });

  it("keeps normal review entries reviewable", async () => {
    const { hasDodHumanActionRequirement } = await import("./skill-context.tools");

    expect(hasDodHumanActionRequirement({ definitionOfDone: "- Tests pass" })).toBe(false);
    expect(hasDodHumanActionRequirement(null)).toBe(false);
    expect(hasDodHumanActionRequirement(undefined)).toBe(false);
  });
});
