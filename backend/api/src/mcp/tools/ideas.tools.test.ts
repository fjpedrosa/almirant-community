import { afterAll, describe, expect, it, mock } from "bun:test";
import { createDatabaseMocks, createWsMock, restoreRealModules } from "../../test/mocks";
import { testIdeaItem, testWorkItem } from "../../test/fixtures";

mock.module("@almirant/database", () => createDatabaseMocks());
mock.module("../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../setup", () => ({
  getWorkspaceIdFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const workspaceId = extra.authInfo?.extra?.workspaceId;
    return typeof workspaceId === "string" ? workspaceId : undefined;
  },
  getProjectIdFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const projectId = extra.authInfo?.extra?.projectId;
    return typeof projectId === "string" ? projectId : undefined;
  },
  getManagedByAgentFromExtra: (extra: { authInfo?: { clientId?: string } }) => {
    const clientId = extra.authInfo?.clientId?.toLowerCase();
    if (!clientId) return undefined;
    if (clientId.includes("codex")) return "codex";
    if (clientId.includes("claude")) return "claude-code";
    return undefined;
  },
  getUserIdFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const userId = extra.authInfo?.extra?.userId;
    return typeof userId === "string" ? userId : undefined;
  },
  // Needed by work-items.tools.ts — mock.module is global in bun so this
  // mock leaks to crud-coverage.tools.test.ts which imports work-items.tools
  getPlanningSessionIdFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const planningSessionId = extra.authInfo?.extra?.planningSessionId;
    return typeof planningSessionId === "string" ? planningSessionId : undefined;
  },
  getPlanningMetadataFromExtra: () => undefined,
}));

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolHandler = (params: Record<string, unknown>, extra: Record<string, unknown>) => Promise<ToolResult>;

const buildToolsRegistry = async () => {
  const tools = new Map<string, ToolHandler>();

  const fakeServer = {
    tool: (name: string, _description: string, _schema: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
      return undefined;
    },
  };

  const { registerIdeasTools } = await import("./ideas.tools");
  registerIdeasTools(fakeServer as never);

  return tools;
};

const withOrg = {
  authInfo: {
    extra: {
      workspaceId: "org-test-1",
      projectId: "proj-test-1",
    },
  },
};

describe("registerIdeasTools", () => {
  it("registers and executes list_idea_items", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("list_idea_items");

    expect(handler).toBeDefined();

    const result = await handler!({ page: 1, limit: 10 }, withOrg);
    expect(result.isError).toBeUndefined();

    const payload = JSON.parse(result.content[0]!.text) as {
      items: Array<{ id: string }>;
      pagination: { total: number };
    };

    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!.id).toBe(testIdeaItem.id);
    expect(payload.pagination.total).toBe(1);
  });

  it("returns error when workspace cannot be resolved", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("list_idea_items");

    const result = await handler!({}, { authInfo: { extra: {} } });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("could not resolve workspaceId");
  });

  it("creates idea item through create_idea_item", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("create_idea_item");

    const result = await handler!(
      {
        title: "MCP created idea",
        type: "idea",
        status: "active",
        description: "from mcp",
      },
      withOrg
    );

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as { title: string; type: string };
    expect(payload.title).toBe("MCP created idea");
    expect(payload.type).toBe("idea");
  });

  it("returns mapped error when project does not belong to active workspace", async () => {
    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        createIdeaItem: async () => {
          throw new Error("PROJECT_NOT_IN_WORKSPACE");
        },
      })
    );

    const tools = await buildToolsRegistry();
    const handler = tools.get("create_idea_item");

    const result = await handler!(
      {
        title: "MCP idea",
        type: "idea",
        projectId: "proj-foreign",
      },
      withOrg
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("does not belong to active workspace");

    mock.module("@almirant/database", () => createDatabaseMocks());
  });

  it("promotes idea item and returns work item + link", async () => {
    const tools = await buildToolsRegistry();
    const handler = tools.get("promote_idea_item");

    const result = await handler!(
      {
        id: testIdeaItem.id,
        workItemType: "task",
        title: "Promoted from MCP",
        boardId: "board-test-1",
        boardColumnId: "col-test-1",
        projectId: "proj-test-1",
      },
      withOrg
    );

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]!.text) as {
      workItem: { id: string };
      link: { ideaItemId: string; workItemId: string };
    };

    expect(payload.workItem.id).toBe(testWorkItem.id);
    expect(payload.link.ideaItemId).toBe(testIdeaItem.id);
    expect(payload.link.workItemId).toBe(testWorkItem.id);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
