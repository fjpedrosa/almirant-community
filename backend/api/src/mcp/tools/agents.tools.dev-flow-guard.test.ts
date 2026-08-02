import { afterAll, describe, expect, it, mock } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createDatabaseMocks,
  restoreRealModules,
} from "../../test/mocks";

// `mock.module()` is a process-global override, not file-scoped — it MUST be
// restored in afterAll or it leaks into execute-scheduled-agent-config.test.ts
// (the real test suite for this exact module), which runs against whatever
// executeScheduledAgentConfig happens to currently resolve to.
const __realExecuteScheduledAgentConfig = {
  ...(await import("../../domains/agents/services/execute-scheduled-agent-config")),
};

// ---------------------------------------------------------------------------
// dev-flow (issue #230) — system-managed configs (managedBy='system',
// provisioned by dev-flow-provisioning.ts) must not be editable/deletable
// through update_agent / delete_agent. Manual trigger_agent remains allowed
// — see scheduled-agent-access.ts's assertScheduledAgentConfigIsUserManaged.
// ---------------------------------------------------------------------------

const state = {
  updatedInput: null as Record<string, unknown> | null,
  deletedIds: [] as string[],
  triggeredIds: [] as string[],
};

const baseAgent = {
  id: "22222222-2222-4222-8222-222222222222",
  workspaceId: "workspace-1",
  ownerUserId: null,
  projectId: "proj-1",
  name: "Backlog drain",
  prompt: null,
  description: "Picks ready Backlog work items on each tick and enqueues implementation jobs.",
  jobType: "implementation" as const,
  provider: "claude-code" as const,
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  aiModel: null,
  reasoningLevel: null,
  skillId: null,
  trigger: "scheduled" as const,
  webhookToken: null,
  scheduleType: "cron" as const,
  scheduleConfig: { expression: "*/5 * * * *" },
  timezone: "Europe/Madrid",
  enabled: true,
  targetConfig: { backlogDrain: { enabled: true } },
  mcpServers: null,
  maxJobsPerRun: 10,
  pausedUntil: null,
  lastRunAt: null,
  managedBy: "system" as const,
  builtinAutomationId: "backlog-drain",
  createdAt: new Date("2026-07-10T00:00:00.000Z"),
  updatedAt: new Date("2026-07-10T00:00:00.000Z"),
};

const userAgent = { ...baseAgent, id: "33333333-3333-4333-8333-333333333333", managedBy: "user" as const, builtinAutomationId: null };

const agentsById = new Map<string, typeof baseAgent | typeof userAgent>([
  [baseAgent.id, baseAgent],
  [userAgent.id, userAgent],
]);

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getScheduledAgentConfigById: async (id: string, workspaceId: string) => {
      const agent = agentsById.get(id);
      return agent && agent.workspaceId === workspaceId ? agent : undefined;
    },
    updateScheduledAgentConfig: async (
      _id: string,
      _workspaceId: string,
      input: Record<string, unknown>,
    ) => {
      state.updatedInput = input;
      return { ...baseAgent, ...input };
    },
    deleteScheduledAgentConfig: async (id: string) => {
      state.deletedIds.push(id);
      return true;
    },
    findActiveConnections: async () => [{ config: { implementationModel: "claude-sonnet-4-5" } }],
  }),
);

// executeScheduledAgentConfig used by trigger_agent lives in a service module,
// not @almirant/database — mock it directly so manual trigger doesn't need a
// real job-creation pipeline.
mock.module("../../domains/agents/services/execute-scheduled-agent-config", () => ({
  executeScheduledAgentConfig: async (config: Record<string, unknown>) => {
    state.triggeredIds.push(config.id as string);
    return { id: "job-1", status: "queued" };
  },
}));

type ToolHandler = (
  params: Record<string, unknown>,
  extra: { authInfo?: { extra?: Record<string, unknown> } },
) => Promise<{ isError?: boolean; content: Array<{ type: "text"; text: string }> }>;

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
      workspaceId: baseAgent.workspaceId,
      userId: "authenticated-user",
    },
  },
};

describe("agents MCP dev-flow system-managed guard", () => {
  it("update_agent rejects a system-managed agent", async () => {
    state.updatedInput = null;
    const handler = (await loadHandlers()).get("update_agent")!;

    const result = await handler(
      { id: baseAgent.id, description: "trying to edit" },
      authExtra,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("dev-flow");
    expect(state.updatedInput).toBeNull();
  });

  it("delete_agent rejects a system-managed agent", async () => {
    state.deletedIds = [];
    const handler = (await loadHandlers()).get("delete_agent")!;

    const result = await handler({ id: baseAgent.id }, authExtra);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("dev-flow");
    expect(state.deletedIds).toEqual([]);
  });

  it("trigger_agent still allows manually triggering a system-managed agent", async () => {
    state.triggeredIds = [];
    const handler = (await loadHandlers()).get("trigger_agent")!;

    const result = await handler({ id: baseAgent.id }, authExtra);

    expect(result.isError).toBeUndefined();
    expect(state.triggeredIds).toEqual([baseAgent.id]);
  });

  it("update_agent still allows editing a user-managed agent", async () => {
    state.updatedInput = null;
    const handler = (await loadHandlers()).get("update_agent")!;

    const result = await handler(
      { id: userAgent.id, description: "still editable" },
      authExtra,
    );

    expect(result.isError).toBeUndefined();
    expect(state.updatedInput).toMatchObject({ description: "still editable" });
  });

  it("delete_agent still allows deleting a user-managed agent", async () => {
    state.deletedIds = [];
    const handler = (await loadHandlers()).get("delete_agent")!;

    const result = await handler({ id: userAgent.id }, authExtra);

    expect(result.isError).toBeUndefined();
    expect(state.deletedIds).toEqual([userAgent.id]);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module(
    "../../domains/agents/services/execute-scheduled-agent-config",
    () => __realExecuteScheduledAgentConfig,
  );
});
