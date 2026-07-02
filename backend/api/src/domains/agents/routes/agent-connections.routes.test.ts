import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createResponseMocks,
  withTestOrg,
} from "../../../test/mocks";
import { testWorkspace, testProject, testUser } from "../../../test/fixtures";

const state = {
  createdKeys: [] as Array<{
    workspaceId: string;
    name: string;
    opts: Record<string, unknown> | undefined;
  }>,
  revokedIds: [] as string[],
  projectWorkspaceId: testWorkspace.id as string | null,
  publicUrl: "https://selfhost.tailnet.example.com",
};

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    resolveProjectWorkspace: async () => state.projectWorkspaceId,
    createApiKey: async (
      workspaceId: string,
      name: string,
      opts?: Record<string, unknown>,
    ) => {
      state.createdKeys.push({ workspaceId, name, opts });
      return {
        id: `key-${state.createdKeys.length}`,
        name,
        keyPrefix: "mock-key-prefix",
        key: "mock-api-key-value",
        createdAt: new Date("2026-04-26T10:00:00.000Z"),
      };
    },
    listApiKeys: async () => [
      {
        id: "key-external",
        name: "External agent: OpenClaw",
        keyPrefix: "mock-external-prefix",
        isActive: true,
        userId: testUser.id,
        serviceAccountId: null,
        workspaceId: testWorkspace.id,
        allowedIssuedPermissions: ["mcp:read", "mcp:write"],
        lastUsedAt: null,
        createdAt: new Date("2026-04-26T10:00:00.000Z"),
      },
      {
        id: "key-normal",
        name: "Manual key",
        keyPrefix: "mock-manual-prefix",
        isActive: true,
        userId: testUser.id,
        serviceAccountId: null,
        workspaceId: testWorkspace.id,
        allowedIssuedPermissions: ["mcp:read", "mcp:write"],
        lastUsedAt: null,
        createdAt: new Date("2026-04-26T09:00:00.000Z"),
      },
    ],
    revokeApiKey: async (_workspaceId: string, id: string) => {
      state.revokedIds.push(id);
      return id === "key-external";
    },
    getProjectById: async () => ({
      ...testProject,
      name: "Mission Control",
    }),
  }),
);

mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../instance/services/instance-config-service", () => ({
  getInstanceConfig: async () => ({ publicUrl: state.publicUrl }),
}));

const makeProtectedApp = async () => {
  const { agentConnectionsRoutes } = await import("./agent-connections.routes");
  return new Elysia().use(withTestOrg).use(agentConnectionsRoutes.protected());
};

const makePublicApp = async () => {
  const { agentConnectionsRoutes } = await import("./agent-connections.routes");
  return new Elysia().use(agentConnectionsRoutes.public());
};

describe("agent connection routes", () => {
  beforeEach(async () => {
    state.createdKeys = [];
    state.revokedIds = [];
    state.projectWorkspaceId = testWorkspace.id;
    state.publicUrl = "https://selfhost.tailnet.example.com";

    const store = await import("../services/agent-connection-link-token-store");
    store.clearAgentConnectionLinkTokensForTests();
  });

  it("creates a short-lived claim prompt for a project owned by the active workspace", async () => {
    const app = await makeProtectedApp();

    const res = await app.handle(
      new Request("http://localhost/agent-connections/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: testProject.id, agentName: "OpenClaw" }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json() as {
      success: boolean;
      data: {
        prompt: string;
        claimUrl: string;
        expiresAt: string;
        scope: { type: "project"; projectId: string; projectName: string };
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.claimUrl).toMatch(/^https:\/\/selfhost\.tailnet\.example\.com\/api\/agent-connections\/claim\//);
    expect(body.data.prompt).toContain("Haz una llamada GET");
    expect(body.data.prompt).toContain("UNA SOLA llamada GET");
    expect(body.data.prompt).toContain(body.data.claimUrl);
    expect(body.data.prompt).toContain('proyecto "Mission Control"');
    expect(body.data.scope).toEqual({
      type: "project",
      projectId: testProject.id,
      projectName: "Mission Control",
    });
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("creates an all-projects claim prompt when no project is selected", async () => {
    const app = await makeProtectedApp();

    const res = await app.handle(
      new Request("http://localhost/agent-connections/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "OpenClaw" }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json() as {
      success: boolean;
      data: {
        prompt: string;
        scope: { type: "all-projects" };
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.scope).toEqual({ type: "all-projects" });
    expect(body.data.prompt).toContain("todos los proyectos disponibles");
    expect(body.data.prompt).toContain("explora la lista de proyectos disponibles");
  });

  it("rejects link-token creation when the project does not belong to the current user workspace", async () => {
    state.projectWorkspaceId = "other-org";
    const app = await makeProtectedApp();

    const res = await app.handle(
      new Request("http://localhost/agent-connections/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: testProject.id }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it("claims a token once and returns MCP instructions plus a scoped API key", async () => {
    const protectedApp = await makeProtectedApp();
    const created = await protectedApp.handle(
      new Request("http://localhost/agent-connections/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: testProject.id, agentName: "OpenClaw" }),
      }),
    );
    const createdBody = await created.json() as { data: { claimUrl: string } };
    const claimPath = new URL(createdBody.data.claimUrl).pathname;

    const publicApp = await makePublicApp();
    const first = await publicApp.handle(new Request(`http://localhost${claimPath}`));

    expect(first.status).toBe(200);
    const body = await first.json() as {
      success: boolean;
      data: {
        status: string;
        scope: { type: "project"; projectId: string; projectName: string };
        apiKeyId: string;
        mcpConfig: { mcpServers: { almirant: { url: string; headers: { Authorization: string } } } };
        instructions: string[];
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.status).toBe("claimed");
    expect(body.data.scope).toEqual({
      type: "project",
      projectId: testProject.id,
      projectName: "Mission Control",
    });
    expect(body.data.mcpConfig.mcpServers.almirant.url).toBe(
      `https://selfhost.tailnet.example.com/mcp?projectId=${testProject.id}`,
    );
    expect(body.data.mcpConfig.mcpServers.almirant.headers.Authorization).toBe(
      "Bearer mock-api-key-value",
    );
    expect(body.data.instructions.join("\n")).toContain("almirant");
    expect(state.createdKeys).toEqual([
      {
        workspaceId: testWorkspace.id,
        name: "External agent: OpenClaw",
        opts: {
          userId: testUser.id,
          allowedIssuedPermissions: ["mcp:read", "mcp:write"],
        },
      },
    ]);

    const second = await publicApp.handle(new Request(`http://localhost${claimPath}`));
    expect(second.status).toBe(200);
    const secondBody = await second.json() as {
      success: boolean;
      data: {
        apiKeyId: string;
        mcpConfig: { mcpServers: { almirant: { headers: { Authorization: string } } } };
      };
    };

    expect(secondBody.success).toBe(true);
    expect(secondBody.data.apiKeyId).toBe(body.data.apiKeyId);
    expect(secondBody.data.mcpConfig.mcpServers.almirant.headers.Authorization).toBe(
      "Bearer mock-api-key-value",
    );
    expect(state.createdKeys).toHaveLength(1);
  });

  it("claims an all-projects token without adding projectId to the MCP URL", async () => {
    const protectedApp = await makeProtectedApp();
    const created = await protectedApp.handle(
      new Request("http://localhost/agent-connections/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: "OpenClaw" }),
      }),
    );
    const createdBody = await created.json() as { data: { claimUrl: string } };
    const claimPath = new URL(createdBody.data.claimUrl).pathname;

    const publicApp = await makePublicApp();
    const first = await publicApp.handle(new Request(`http://localhost${claimPath}`));

    expect(first.status).toBe(200);
    const body = await first.json() as {
      data: {
        projectId: string | null;
        scope: { type: "all-projects" };
        mcpConfig: { mcpServers: { almirant: { url: string } } };
        instructions: string[];
      };
    };

    expect(body.data.projectId).toBeNull();
    expect(body.data.scope).toEqual({ type: "all-projects" });
    expect(body.data.mcpConfig.mcpServers.almirant.url).toBe(
      "https://selfhost.tailnet.example.com/mcp",
    );
    expect(body.data.instructions.join("\n")).toContain("explora los proyectos disponibles");
  });

  it("lists and revokes only external-agent API keys", async () => {
    const app = await makeProtectedApp();

    const list = await app.handle(new Request("http://localhost/agent-connections"));
    const listBody = await list.json() as {
      data: Array<{
        id: string;
        name: string;
        keyPrefix: string;
        isActive: boolean;
        verificationStatus: "pending" | "verified";
        lastUsedAt: string | null;
        createdAt: string | null;
      }>;
    };

    expect(list.status).toBe(200);
    expect(listBody.data).toEqual([
      {
        id: "key-external",
        name: "OpenClaw",
        keyPrefix: "mock-external-prefix",
        isActive: true,
        verificationStatus: "pending",
        lastUsedAt: null,
        createdAt: "2026-04-26T10:00:00.000Z",
      },
    ]);

    const revoked = await app.handle(
      new Request("http://localhost/agent-connections/key-external", { method: "DELETE" }),
    );

    expect(revoked.status).toBe(200);
    expect(state.revokedIds).toEqual(["key-external"]);
  });

  it("does not revoke regular API keys through the external-agent endpoint", async () => {
    const app = await makeProtectedApp();

    const revoked = await app.handle(
      new Request("http://localhost/agent-connections/key-normal", { method: "DELETE" }),
    );

    expect(revoked.status).toBe(404);
    expect(state.revokedIds).toEqual([]);
  });
});
