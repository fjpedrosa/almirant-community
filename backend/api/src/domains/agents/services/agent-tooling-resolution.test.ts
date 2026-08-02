import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createLoggerMock,
  restoreRealModules,
} from "../../../test/mocks";

const mcpId = "6e9fa58b-3490-4e39-982f-444e5c697e55";
const secondMcpId = "87c9291a-7e68-42e4-9eb2-5b777ae1fc49";
const pluginId = "9c1f6f0e-9b7e-4b8a-8b0e-7f6c2e5a1d33";

const state = {
  associatedMcpIds: [] as string[],
  mcpProfiles: [] as Array<Record<string, unknown>>,
  plugins: [] as Array<Record<string, unknown>>,
  marketplaces: [] as Array<Record<string, unknown>>,
};

const buildMcpProfile = (
  id: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  workspaceId: "workspace-1",
  projectId: null,
  ownerUserId: "user-1",
  name: "Private docs",
  slug: "private-docs",
  description: null,
  url: "https://mcp.example.com/mcp",
  transport: "remote",
  visibility: "user",
  authType: "bearer",
  authHeaderName: "Authorization",
  templateKey: null,
  configuration: {},
  keyVersion: 1,
  encryptedCredentials: "must-not-leave-api",
  credentialsIv: "iv",
  credentialsAuthTag: "tag",
  version: 1,
  archivedAt: null,
  createdByUserId: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const buildPlugin = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  workspaceId: "workspace-1",
  ownerUserId: "user-1",
  name: "Repo audit",
  slug: "repo-audit",
  description: null,
  visibility: "user",
  provider: "portable",
  sourceType: "upload",
  marketplaceId: null,
  externalId: null,
  storageObjectId: "storage-object-1",
  checksumSha256: "b".repeat(64),
  manifest: { kind: "portable_skill" },
  instructions: "Use this skill to audit the repo.",
  version: "1",
  enabled: true,
  archivedAt: null,
  createdByUserId: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getScheduledAgentMcpServerIds: async () => state.associatedMcpIds,
    getAgentMcpServersByIds: async () => state.mcpProfiles,
    getAgentPluginsByIds: async () => state.plugins,
    getAgentPluginMarketplacesByIds: async () => state.marketplaces,
  }),
);
mock.module("@almirant/config", () => createLoggerMock());

const { resolveAgentTooling, parseAgentToolingSelection } = await import(
  "./agent-tooling-resolution"
);

describe("parseAgentToolingSelection", () => {
  it("reads selection from the __agentTooling key the frontend wizard writes", () => {
    const selection = parseAgentToolingSelection({
      customFilters: {
        __agentTooling: {
          selectedMcpServerIds: [mcpId],
          selectedPluginIds: [pluginId],
        },
      },
    });
    expect(selection).toEqual({
      selectedMcpServerIds: [mcpId],
      selectedPluginIds: [pluginId],
    });
  });

  it("returns empty arrays when the key is absent, malformed, or ids are not valid uuids", () => {
    expect(parseAgentToolingSelection(undefined)).toEqual({
      selectedMcpServerIds: [],
      selectedPluginIds: [],
    });
    expect(parseAgentToolingSelection({ customFilters: {} })).toEqual({
      selectedMcpServerIds: [],
      selectedPluginIds: [],
    });
    expect(
      parseAgentToolingSelection({
        customFilters: { __agentTooling: { selectedMcpServerIds: ["not-a-uuid"] } },
      }),
    ).toEqual({ selectedMcpServerIds: [], selectedPluginIds: [] });
  });
});

describe("resolveAgentTooling", () => {
  beforeEach(() => {
    state.associatedMcpIds = [];
    state.mcpProfiles = [buildMcpProfile(mcpId)];
    state.plugins = [];
    state.marketplaces = [];
  });

  it("pins persisted MCP profiles to the safe gateway without decrypting secrets into job config", async () => {
    const result = await resolveAgentTooling({
      id: "agent-config-1",
      workspaceId: "workspace-1",
      ownerUserId: "user-1",
      mcpServers: {
        legacy_direct: {
          type: "remote",
          url: "https://internal.example/mcp",
          enabled: true,
          oauth: false,
        },
      },
      targetConfig: {
        customFilters: {
          __agentTooling: {
            selectedMcpServerIds: [mcpId],
            selectedPluginIds: [],
          },
        },
      },
    });

    expect(result.mcpServers).toEqual({
      "private-docs": {
        type: "remote",
        url: "https://mcp.example.com/mcp",
        enabled: true,
        oauth: false,
        almirantServerId: mcpId,
      },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leave-api");
    expect(JSON.stringify(result)).not.toContain("Bearer");
    expect(JSON.stringify(result)).not.toContain("internal.example");
    expect(result.selectedMcpServerIds).toEqual([mcpId]);
  });

  it("ignores the legacy inline mcpServers blob entirely -- it never reaches the resolved output", async () => {
    state.mcpProfiles = [];
    const result = await resolveAgentTooling({
      id: "agent-config-1",
      workspaceId: "workspace-1",
      ownerUserId: "user-1",
      mcpServers: {
        legacy_direct: {
          type: "remote",
          url: "https://internal.example/mcp",
          enabled: true,
          oauth: false,
        },
      },
      targetConfig: {},
    });

    expect(result.mcpServers).toBeNull();
    expect(result.selectedMcpServerIds).toEqual([]);
  });

  it("uses normalized MCP associations as authoritative over the raw wizard selection", async () => {
    state.associatedMcpIds = [secondMcpId];
    state.mcpProfiles = [
      buildMcpProfile(secondMcpId, {
        slug: "scraper",
        name: "Scraper",
        url: "https://scraper.example.com/mcp",
      }),
    ];

    const result = await resolveAgentTooling({
      id: "agent-config-1",
      workspaceId: "workspace-1",
      ownerUserId: "user-1",
      mcpServers: null,
      targetConfig: {
        customFilters: {
          __agentTooling: {
            selectedMcpServerIds: [mcpId],
            selectedPluginIds: [],
          },
        },
      },
    });

    expect(result.selectedMcpServerIds).toEqual([secondMcpId]);
    expect(Object.keys(result.mcpServers ?? {})).toEqual(["scraper"]);
  });

  it("fails closed when any selected MCP profile cannot be resolved exactly", async () => {
    state.associatedMcpIds = [mcpId, secondMcpId];
    state.mcpProfiles = [buildMcpProfile(mcpId)];

    await expect(
      resolveAgentTooling({
        id: "agent-config-1",
        workspaceId: "workspace-1",
        ownerUserId: "user-1",
        mcpServers: null,
        targetConfig: {},
      }),
    ).rejects.toThrow(/selected mcp profiles.*could not be resolved/i);
  });

  it("resolves selected plugins into secret-free runtime references", async () => {
    state.mcpProfiles = [];
    state.plugins = [buildPlugin(pluginId)];

    const result = await resolveAgentTooling({
      id: "agent-config-1",
      workspaceId: "workspace-1",
      ownerUserId: "user-1",
      mcpServers: null,
      targetConfig: {
        customFilters: {
          __agentTooling: {
            selectedMcpServerIds: [],
            selectedPluginIds: [pluginId],
          },
        },
      },
    });

    expect(result.agentPlugins).toEqual([
      {
        id: pluginId,
        slug: "repo-audit",
        name: "Repo audit",
        kind: "portable_skill",
        provider: "portable",
        sourceType: "upload",
        version: "1",
        checksumSha256: "b".repeat(64),
      },
    ]);
    expect(result.selectedPluginIds).toEqual([pluginId]);
  });

  it("fails closed when a selected plugin cannot be resolved or is disabled", async () => {
    state.mcpProfiles = [];
    state.plugins = [];

    await expect(
      resolveAgentTooling({
        id: "agent-config-1",
        workspaceId: "workspace-1",
        ownerUserId: "user-1",
        mcpServers: null,
        targetConfig: {
          customFilters: {
            __agentTooling: { selectedMcpServerIds: [], selectedPluginIds: [pluginId] },
          },
        },
      }),
    ).rejects.toThrow(/selected plugins.*could not be resolved/i);

    state.plugins = [buildPlugin(pluginId, { enabled: false })];
    await expect(
      resolveAgentTooling({
        id: "agent-config-1",
        workspaceId: "workspace-1",
        ownerUserId: "user-1",
        mcpServers: null,
        targetConfig: {
          customFilters: {
            __agentTooling: { selectedMcpServerIds: [], selectedPluginIds: [pluginId] },
          },
        },
      }),
    ).rejects.toThrow(/selected plugins are disabled/i);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
