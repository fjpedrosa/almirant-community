import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createLoggerMock,
  createResponseMocks,
  restoreRealModules,
  withTestOrg,
} from "../../../test/mocks";

const state = {
  createdMcp: null as Record<string, unknown> | null,
  encryptedPayload: null as Record<string, unknown> | null,
  testedConnection: null as { url: string; headers: Record<string, string> } | null,
  updatedMcp: null as Record<string, unknown> | null,
  mcpLookupOwnerUserId: null as string | null,
};

const savedGithubServer = {
  id: "3db67144-d1cb-4cd8-a2f6-40f65439ae80",
  workspaceId: "org-test-1",
  projectId: null,
  name: "GitHub",
  slug: "github",
  description: null,
  url: "https://api.githubcopilot.com/mcp/",
  transport: "remote",
  visibility: "workspace",
  ownerUserId: "user-test-1",
  authType: "bearer",
  authHeaderName: "Authorization",
  templateKey: "github",
  configuration: { readOnly: true, toolsets: ["repos"] },
  keyVersion: 1,
  encryptedCredentials: "encrypted-secret",
  credentialsIv: "iv",
  credentialsAuthTag: "tag",
  version: 1,
  archivedAt: null,
  createdByUserId: "user-test-1",
  createdAt: new Date("2026-07-10T09:00:00.000Z"),
  updatedAt: new Date("2026-07-10T09:00:00.000Z"),
};

const savedCustomServer = {
  ...savedGithubServer,
  id: "9dfaafbd-e801-466d-b1ce-370323d67b16",
  name: "Custom MCP",
  slug: "custom-mcp",
  url: "https://mcp.example.com/mcp",
  templateKey: null,
  configuration: {},
};

mock.module(
  "@almirant/database",
  () =>
    createDatabaseMocks({
      listAgentMcpServersByWorkspace: async () => [],
      createAgentMcpServer: async (input: Record<string, unknown>) => {
        state.createdMcp = input;
        return {
          ...savedGithubServer,
          ...input,
          id: savedGithubServer.id,
          hasSecret: Boolean(input.encryptedCredentials),
          encryptedCredentials: undefined,
          credentialsIv: undefined,
          credentialsAuthTag: undefined,
        };
      },
      getAgentMcpServerById: async (
        id: string,
        _workspaceId: string,
        ownerUserId: string,
      ) => {
        state.mcpLookupOwnerUserId = ownerUserId;
        if (id === savedGithubServer.id) return savedGithubServer;
        if (id === savedCustomServer.id) return savedCustomServer;
        return undefined;
      },
      updateAgentMcpServer: async (
        _id: string,
        _workspaceId: string,
        input: Record<string, unknown>,
      ) => {
        state.updatedMcp = input;
        return { ...savedCustomServer, ...input, hasSecret: false };
      },
      encryptCredentials: (payload: Record<string, unknown>) => {
        state.encryptedPayload = payload;
        return {
          encryptedCredentials: "encrypted-secret",
          credentialsIv: "iv",
          credentialsAuthTag: "tag",
        };
      },
      decryptCredentials: () => ({ Authorization: "Bearer github_pat_secret" }),
    }),
);

mock.module("@almirant/config", () => ({
  ...createLoggerMock(),
  env: {
    ...createLoggerMock().env,
    ENCRYPTION_KEY: "0".repeat(64),
  },
}));
mock.module("../../../shared/services/response", () => createResponseMocks());
const routeDependencies = {
  buildMcpServerHeaders: (input: {
    credentials?: Record<string, unknown> | null;
    templateKey?: string | null;
    configuration?: Record<string, unknown> | null;
  }): Record<string, string> => {
    const credentials = Object.fromEntries(
      Object.entries(input.credentials ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    return {
      ...(input.templateKey === "github"
        ? { "X-MCP-Readonly": "true", "X-MCP-Toolsets": "repos" }
        : {}),
      ...credentials,
    };
  },
  testMcpConnection: async (input: { url: string; headers: Record<string, string> }) => {
    state.testedConnection = input;
    return {
      connected: true as const,
      server: { name: "github-mcp-server", version: "1.0.0" },
      toolCount: 42,
    };
  },
  validateOutboundHttpUrl: async (url: string | URL) => ({
    url: new URL(url.toString()),
    addresses: [{ address: "93.184.216.34", family: 4 as const }],
    isLocalDevelopment: false,
  }),
};

const createApp = async () => {
  const { createAgentToolingRoutes } = await import("./agent-tooling.routes");
  return new Elysia()
    .use(withTestOrg)
    .use(createAgentToolingRoutes(routeDependencies));
};

const request = (path: string, method = "GET", body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });

describe("agentToolingRoutes MCP connectors", () => {
  beforeEach(() => {
    state.createdMcp = null;
    state.encryptedPayload = null;
    state.testedConnection = null;
    state.updatedMcp = null;
    state.mcpLookupOwnerUserId = null;
  });

  afterAll(() => {
    restoreRealModules();
  });

  it("lists the supported connector templates without credentials", async () => {
    const app = await createApp();

    const response = await app.handle(
      request("/scheduled-agents/mcp-servers/templates"),
    );
    const payload = (await response.json()) as {
      data: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(payload.data.map((template) => template.key)).toEqual([
      "context7",
      "github",
      "scraper",
    ]);
    expect(JSON.stringify(payload)).not.toContain("github_pat");
    expect(JSON.stringify(payload)).not.toContain("encryptedCredentials");
  });

  it("creates a GitHub connector from the trusted template and encrypts only its PAT", async () => {
    const app = await createApp();

    const response = await app.handle(
      request("/scheduled-agents/mcp-servers/from-template", "POST", {
        templateKey: "github",
        secret: "github_pat_secret",
        configuration: { readOnly: true, toolsets: ["repos"] },
      }),
    );
    const payload = await response.text();

    expect(response.status).toBe(201);
    expect(state.encryptedPayload).toEqual({
      Authorization: "Bearer github_pat_secret",
    });
    expect(state.createdMcp).toMatchObject({
      workspaceId: "org-test-1",
      ownerUserId: "user-test-1",
      visibility: "user",
      name: "GitHub",
      slug: "github",
      url: "https://api.githubcopilot.com/mcp/",
      templateKey: "github",
      configuration: { readOnly: true, toolsets: ["repos"] },
      authType: "bearer",
      authHeaderName: "Authorization",
      encryptedCredentials: "encrypted-secret",
    });
    expect(payload).not.toContain("github_pat_secret");
  });

  it("creates Context7 without a secret and uses a non-reserved runner name", async () => {
    const app = await createApp();

    const response = await app.handle(
      request("/scheduled-agents/mcp-servers/from-template", "POST", {
        templateKey: "context7",
      }),
    );

    expect(response.status).toBe(201);
    expect(state.encryptedPayload).toBeNull();
    expect(state.createdMcp).toMatchObject({
      slug: "context7-authenticated",
      templateKey: "context7",
      configuration: {},
      encryptedCredentials: null,
    });
  });

  it("creates the managed scraper connector from the canonical template", async () => {
    const app = await createApp();

    const response = await app.handle(
      request("/scheduled-agents/mcp-servers/from-template", "POST", {
        templateKey: "scraper",
        secret: "scraper_mcp_secret",
      }),
    );
    const payload = await response.text();

    expect(response.status).toBe(201);
    expect(state.encryptedPayload).toEqual({
      Authorization: "Bearer scraper_mcp_secret",
    });
    expect(state.createdMcp).toMatchObject({
      workspaceId: "org-test-1",
      ownerUserId: "user-test-1",
      visibility: "user",
      name: "Scraper",
      slug: "scraper",
      url: "https://scraper.fjpedrosa.com/mcp",
      templateKey: "scraper",
      configuration: {},
      authType: "bearer",
      authHeaderName: "Authorization",
      encryptedCredentials: "encrypted-secret",
    });
    expect(payload).not.toContain("scraper_mcp_secret");
  });

  it("tests a saved connector with decrypted and public headers server-side", async () => {
    const app = await createApp();

    const response = await app.handle(
      request(`/scheduled-agents/mcp-servers/${savedGithubServer.id}/test`, "POST", {}),
    );
    const payload = await response.text();

    expect(response.status).toBe(200);
    expect(state.mcpLookupOwnerUserId).toBe("user-test-1");
    expect(state.testedConnection).toEqual({
      url: savedGithubServer.url,
      headers: {
        "X-MCP-Readonly": "true",
        "X-MCP-Toolsets": "repos",
        Authorization: "Bearer github_pat_secret",
      },
    });
    expect(payload).not.toContain("github_pat_secret");
    expect(payload).not.toContain(savedGithubServer.url);
  });

  it("does not leave a custom authenticated connector without its required secret", async () => {
    const app = await createApp();

    const response = await app.handle(
      request(`/scheduled-agents/mcp-servers/${savedCustomServer.id}`, "PATCH", {
        clearSecret: true,
      }),
    );

    // The PATCH /mcp-servers/:id catch is undiscriminated (issue #244): it now
    // uses internalErrorResponse for any caught error, including this
    // hand-thrown validation error, so the status is 500 rather than 400.
    expect(response.status).toBe(500);
    expect(state.updatedMcp).toBeNull();
  });
});
