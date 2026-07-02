import { describe, expect, it, spyOn, afterAll } from "bun:test";
import * as database from "@almirant/database";
import { testWorkItem } from "../../test/fixtures";

// ---------------------------------------------------------------------------
// Spy on every database / service function the MCP tool handlers actually
// call during registration or during the get_work_item test.  The tools
// import these at the module level, and Bun's spyOn patches the live binding
// so the spied implementation is used when the tools call the functions.
// ---------------------------------------------------------------------------

// Database spies — only the ones actually invoked in the tests below.
const getWorkItemByIdSpy = spyOn(database, "getWorkItemById").mockImplementation(
  (async (id: string) => (id === testWorkItem.id ? testWorkItem : null)) as never,
);

// Some tool registration code may eagerly reference functions even if it
// doesn't call them. No need to spy on those — they just need to exist on the
// real module and they do.

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
      workspaceId: "org-test-1",
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

  const [
    { registerIdeasTools },
    { registerSeedsTools },
    { registerTodosTools },
    { registerWorkItemsTools },
  ] = await Promise.all([
    import("./ideas.tools"),
    import("./seeds.tools"),
    import("./todos.tools"),
    import("./work-items.tools"),
  ]);

  registerIdeasTools(fakeServer as never);
  registerSeedsTools(fakeServer as never);
  registerTodosTools(fakeServer as never);
  registerWorkItemsTools(fakeServer as never);

  return tools;
};

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(() => {
  getWorkItemByIdSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP CRUD coverage", () => {
  it("registers minimum CRUD tools for todos, ideas, seeds, and work_items", async () => {
    const tools = await buildToolsRegistry();

    const expectedToolNames = [
      "create_todo_item",
      "get_todo_item",
      "list_todo_items",
      "update_todo_item",
      "delete_todo_item",
      "create_idea_item",
      "get_idea_item",
      "list_idea_items",
      "update_idea_item",
      "delete_idea_item",
      "create_seed",
      "get_seed",
      "list_seeds",
      "update_seed",
      "delete_seed",
      "create_work_item",
      "get_work_item",
      "list_work_items",
      "update_work_item",
      "delete_work_item",
    ];

    for (const toolName of expectedToolNames) {
      expect(tools.has(toolName)).toBe(true);
    }
  });

  it("executes get_work_item and returns the expected work item", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("get_work_item");

    expect(handler).toBeDefined();

    const result = await handler!({ id: testWorkItem.id }, withOrg);

    expect(result.isError).toBeUndefined();

    const payload = JSON.parse(result.content[0]!.text) as {
      id: string;
      title: string;
    };
    expect(payload.id).toBe(testWorkItem.id);
    expect(payload.title).toBe(testWorkItem.title);
  });
});
