import { afterAll, describe, expect, it, mock } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createDatabaseMocks,
  restoreRealModules,
} from "../../test/mocks";

const state = {
  createdInput: null as Record<string, unknown> | null,
  updatedInput: null as Record<string, unknown> | null,
};

const existingAgent = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "workspace-1",
  ownerUserId: "persisted-owner",
  projectId: null,
  name: "Owned agent",
  prompt: null,
  description: null,
  jobType: "scheduled" as const,
  provider: "claude-code" as const,
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  aiModel: "claude-sonnet-4-5",
  reasoningLevel: null,
  skillId: null,
  trigger: "scheduled" as const,
  webhookToken: null,
  scheduleType: "manual" as const,
  scheduleConfig: null,
  timezone: "Europe/Madrid",
  enabled: false,
  targetConfig: {},
  mcpServers: null,
  maxJobsPerRun: 10,
  pausedUntil: null,
  lastRunAt: null,
  createdAt: new Date("2026-07-10T00:00:00.000Z"),
  updatedAt: new Date("2026-07-10T00:00:00.000Z"),
};

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    createScheduledAgentConfig: async (input: Record<string, unknown>) => {
      state.createdInput = input;
      return { ...existingAgent, ...input };
    },
    getScheduledAgentConfigById: async (id: string, workspaceId: string) =>
      id === existingAgent.id && workspaceId === existingAgent.workspaceId
        ? existingAgent
        : undefined,
    updateScheduledAgentConfig: async (
      _id: string,
      _workspaceId: string,
      input: Record<string, unknown>,
    ) => {
      state.updatedInput = input;
      return { ...existingAgent, ...input };
    },
    findActiveConnections: async () => [
      { config: { implementationModel: "claude-sonnet-4-5" } },
    ],
  }),
);

type ToolHandler = (
  params: Record<string, unknown>,
  extra: { authInfo?: { extra?: Record<string, unknown> } },
) => Promise<unknown>;

const loadHandlers = async (): Promise<Map<string, ToolHandler>> => {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, ...args: unknown[]) => {
      const handler = args.at(-1);
      if (typeof handler === "function") {
        handlers.set(name, handler as ToolHandler);
      }
    },
  };
  const { registerAgentsTools } = await import("./agents.tools");
  registerAgentsTools(server as unknown as McpServer);
  return handlers;
};

const authExtra = {
  authInfo: {
    extra: {
      workspaceId: existingAgent.workspaceId,
      userId: "authenticated-user",
    },
  },
};

const ownerAuthExtra = {
  authInfo: {
    extra: {
      workspaceId: existingAgent.workspaceId,
      userId: existingAgent.ownerUserId,
    },
  },
};

describe("agents MCP ownership", () => {
  it("records the authenticated MCP actor as owner on create", async () => {
    state.createdInput = null;
    const handler = (await loadHandlers()).get("create_agent");
    expect(handler).toBeDefined();

    await handler!(
      {
        name: "Created through MCP",
        jobType: "scheduled",
        provider: "claude-code",
        scheduleType: "manual",
      },
      authExtra,
    );

    expect(state.createdInput).toMatchObject({
      workspaceId: existingAgent.workspaceId,
      ownerUserId: "authenticated-user",
    });
  });

  it("preserves the persisted owner on update", async () => {
    state.updatedInput = null;
    const handler = (await loadHandlers()).get("update_agent");
    expect(handler).toBeDefined();

    await handler!(
      {
        id: existingAgent.id,
        description: "Updated through MCP",
        ownerUserId: "forged-owner",
      },
      ownerAuthExtra,
    );

    expect(state.updatedInput).toMatchObject({
      description: "Updated through MCP",
      ownerUserId: existingAgent.ownerUserId,
    });
  });

  it("rejects updates from another workspace member", async () => {
    state.updatedInput = null;
    const handler = (await loadHandlers()).get("update_agent");

    const result = await handler!(
      { id: existingAgent.id, description: "Cross-user update" },
      authExtra,
    ) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(state.updatedInput).toBeNull();
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
