import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createLoggerMock,
  restoreRealModules,
} from "../../../test/mocks";

type CreatedJob = {
  id?: string;
  projectId: string | null;
  workspaceId?: string | null;
  config: Record<string, unknown>;
};

const configId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const mcpId = "6e9fa58b-3490-4e39-982f-444e5c697e55";
const pluginId = "9c1f6f0e-9b7e-4b8a-8b0e-7f6c2e5a1d33";

const state = {
  created: [] as CreatedJob[],
  projectRepositories: [] as Array<{ id: string; url: string }>,
  reservationCreated: true,
  existingJob: null as CreatedJob & { id: string; status: string; workItemId: null; planningSessionId: null } | null,
  outputPolicy: null as {
    required: boolean;
    sink: {
      id: string;
      workspaceId: string;
      version: number;
      schemaHash: string;
      payloadSchema: Record<string, unknown>;
      maxPayloadBytes: number;
    };
  } | null,
  mcpProfiles: [] as Array<Record<string, unknown>>,
  associatedMcpIds: [] as string[],
  plugins: [] as Array<Record<string, unknown>>,
  marketplaces: [] as Array<Record<string, unknown>>,
  putBindingCalls: [] as unknown[],
};

const buildMcpProfile = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  workspaceId: "ws-1",
  ownerUserId: null,
  name: "Docs",
  slug: "docs",
  url: "https://mcp.example.com/mcp",
  transport: "remote",
  ...overrides,
});

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    createJob: async (job: CreatedJob) => {
      state.created.push(job);
      return {
        id: job.id ?? "job-1",
        status: "queued",
        workItemId: null,
        planningSessionId: null,
      };
    },
    getRepositories: async () => state.projectRepositories,
    updateScheduledAgentConfigLastRunAt: async () => undefined,
    reserveScheduledAgentRun: async (input: {
      configId: string;
      workspaceId: string;
      dueKey: string;
      triggerType: string;
    }) => ({
      run: {
        id: runId,
        configId: input.configId,
        workspaceId: input.workspaceId,
        dueKey: input.dueKey,
        triggerType: input.triggerType,
      },
      created: state.reservationCreated,
    }),
    linkScheduledAgentRunToJob: async () => undefined,
    getJobById: async () => (state.existingJob ? { job: state.existingJob } : null),
    findScheduledAgentOutputPolicy: async () => state.outputPolicy,
    putAgentOutputBinding: async (input: unknown) => {
      state.putBindingCalls.push(input);
      return { created: true, bindingId: "binding-1" };
    },
    getAgentMcpServersByIds: async () => state.mcpProfiles,
    getScheduledAgentMcpServerIds: async () => state.associatedMcpIds,
    getAgentPluginsByIds: async () => state.plugins,
    getAgentPluginMarketplacesByIds: async () => state.marketplaces,
  }),
);

mock.module("@almirant/config", () => createLoggerMock());

mock.module("../../../shared/ws/ws-connection-manager", () => ({
  wsConnectionManager: { broadcastToWorkspace: mock(() => undefined) },
}));

mock.module("./scheduled-agent-effective-model-resolver", () => ({
  resolveScheduledAgentEffectiveRuntimes: mock(async () => [
    { provider: "claude-code", codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-5", reasoningLevel: "high" },
  ]),
}));

mock.module("./scheduled-agent-runtime-validation", () => ({
  assertValidScheduledAgentRuntime: mock(() => undefined),
}));

// scheduled-agent-project-context is deliberately NOT mocked: it is where the
// repository is actually resolved, and stubbing it is what hid the arbitrary
// fallback in the first place. It has no @almirant/database dependency.

const { executeScheduledAgentConfig, executeScheduledAgentConfigWithResult } =
  await import("./execute-scheduled-agent-config");

const agentConfig = (
  projectId: string | null,
  overrides: Record<string, unknown> = {},
) => ({
  id: configId,
  name: "Weekly SEO review",
  workspaceId: "ws-1",
  ownerUserId: null,
  projectId,
  provider: "claude-code",
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  aiModel: "claude-opus-5",
  reasoningLevel: "high",
  jobType: "scheduled",
  prompt: "do the thing",
  trigger: "scheduled",
  targetConfig: null,
  mcpServers: null,
  ...overrides,
}) as never;

describe("executeScheduledAgentConfig repository resolution", () => {
  beforeEach(() => {
    state.created.length = 0;
    state.projectRepositories = [];
    state.reservationCreated = true;
    state.existingJob = null;
    state.outputPolicy = null;
    state.mcpProfiles = [];
    state.associatedMcpIds = [];
    state.plugins = [];
    state.marketplaces = [];
    state.putBindingCalls.length = 0;
  });

  it("uses the repository of the agent's project", async () => {
    state.projectRepositories = [{ id: "repo-1", url: "https://github.com/acme/site" }];

    await executeScheduledAgentConfig(agentConfig("project-1"), { createdByUserId: null });

    expect(state.created[0]?.config.repoUrl).toBe("https://github.com/acme/site");
    expect(state.created[0]?.config.repositoryId).toBe("repo-1");
    expect(state.created[0]?.config.repositoryResolution).toBe("project");
  });

  it("starts with an empty workspace when the agent has no project", async () => {
    // The old behaviour reached for the workspace's first repository by `order`.
    // With several tied at 0 that is an arbitrary pick, and an agent written for
    // one project would branch and open a PR against another.
    await executeScheduledAgentConfig(agentConfig(null), { createdByUserId: null });

    expect(state.created[0]?.config.repoUrl).toBeUndefined();
    expect(state.created[0]?.config.repositoryId).toBeUndefined();
    expect(state.created[0]?.config.projectId).toBeUndefined();
  });

  it("records why the job has no repository", async () => {
    await executeScheduledAgentConfig(agentConfig(null), { createdByUserId: null });

    expect(state.created[0]?.config.repositoryResolution).toBe("none");
  });

  it("does not borrow a repository when the agent's project has none", async () => {
    state.projectRepositories = [];

    await executeScheduledAgentConfig(agentConfig("project-1"), { createdByUserId: null });

    expect(state.created[0]?.config.repoUrl).toBeUndefined();
    expect(state.created[0]?.config.repositoryResolution).toBe("none");
  });
});

describe("executeScheduledAgentConfig durable dispatch occurrence", () => {
  beforeEach(() => {
    state.created.length = 0;
    state.projectRepositories = [];
    state.reservationCreated = true;
    state.existingJob = null;
    state.outputPolicy = null;
    state.mcpProfiles = [];
    state.associatedMcpIds = [];
    state.plugins = [];
    state.marketplaces = [];
    state.putBindingCalls.length = 0;
  });

  it("pins the job id to the reservation's run id and records the due key/trigger on the job config", async () => {
    const { job, created } = await executeScheduledAgentConfigWithResult(
      agentConfig(null),
      { createdByUserId: null, trigger: "schedule", dueKey: "schedule:2026-08-02" },
    );

    expect(created).toBe(true);
    expect(job.id).toBe(runId);
    expect(state.created[0]?.id).toBe(runId);
    expect(state.created[0]?.config.scheduledDispatchDueKey).toBe("schedule:2026-08-02");
    expect(state.created[0]?.config.scheduledDispatchTrigger).toBe("schedule");
  });

  it("replays the existing job instead of creating a second one when the reservation already existed", async () => {
    state.reservationCreated = false;
    state.existingJob = {
      id: runId,
      status: "queued",
      workItemId: null,
      planningSessionId: null,
      projectId: null,
      config: { scheduledConfigId: configId, scheduledDispatchDueKey: "schedule:2026-08-02" },
    };

    const { job, created } = await executeScheduledAgentConfigWithResult(
      agentConfig(null),
      { createdByUserId: null, trigger: "schedule", dueKey: "schedule:2026-08-02" },
    );

    expect(created).toBe(false);
    expect(job.id).toBe(runId);
    expect(state.created).toHaveLength(0);
  });
});

describe("executeScheduledAgentConfig dispatch-time tooling resolution", () => {
  beforeEach(() => {
    state.created.length = 0;
    state.projectRepositories = [];
    state.reservationCreated = true;
    state.existingJob = null;
    state.outputPolicy = null;
    state.mcpProfiles = [];
    state.associatedMcpIds = [];
    state.plugins = [];
    state.marketplaces = [];
    state.putBindingCalls.length = 0;
  });

  it("materializes the wizard's persisted MCP/plugin selection into the exact job config shape the runner reads", async () => {
    state.mcpProfiles = [buildMcpProfile(mcpId)];
    state.plugins = [
      {
        id: pluginId,
        workspaceId: "ws-1",
        ownerUserId: null,
        name: "Repo audit",
        slug: "repo-audit",
        provider: "portable",
        sourceType: "upload",
        marketplaceId: null,
        storageObjectId: "storage-1",
        checksumSha256: "c".repeat(64),
        manifest: { kind: "portable_skill" },
        version: "1",
        enabled: true,
        archivedAt: null,
      },
    ];

    await executeScheduledAgentConfig(
      agentConfig(null, {
        targetConfig: {
          customFilters: {
            __agentTooling: {
              selectedMcpServerIds: [mcpId],
              selectedPluginIds: [pluginId],
            },
          },
        },
      }),
      { createdByUserId: null },
    );

    const config = state.created[0]?.config;
    // Runner's config-injector.ts cross-validates selectedMcpServerIds
    // against mcpServers[*].almirantServerId -- both must be present and
    // consistent, or every job with a managed MCP selection breaks.
    expect(config?.selectedMcpServerIds).toEqual([mcpId]);
    expect(config?.mcpServers).toEqual({
      docs: {
        type: "remote",
        url: "https://mcp.example.com/mcp",
        enabled: true,
        oauth: false,
        almirantServerId: mcpId,
      },
    });
    expect(config?.selectedPluginIds).toEqual([pluginId]);
    expect(config?.agentPlugins).toEqual([
      {
        id: pluginId,
        slug: "repo-audit",
        name: "Repo audit",
        kind: "portable_skill",
        provider: "portable",
        sourceType: "upload",
        version: "1",
        checksumSha256: "c".repeat(64),
      },
    ]);
  });

  it("ignores the legacy inline mcpServers blob instead of propagating it", async () => {
    await executeScheduledAgentConfig(
      agentConfig(null, {
        mcpServers: {
          legacy_direct: {
            type: "remote",
            url: "https://internal.example/mcp",
            enabled: true,
            oauth: false,
          },
        },
      }),
      { createdByUserId: null },
    );

    expect(state.created[0]?.config).not.toHaveProperty("mcpServers");
    expect(JSON.stringify(state.created[0]?.config)).not.toContain("internal.example");
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
