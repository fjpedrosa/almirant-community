import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createLoggerMock,
  createResponseMocks,
  restoreRealModules,
  withTestOrg,
} from "../../../test/mocks";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_connectionUsageService = { ...(await import("../services/connection-usage-service")) };

const state = {
  deactivateCalls: [] as string[],
  createConnectionCalls: [] as Array<Record<string, unknown>>,
  updateConnectionCalls: [] as Array<{ id: string; input: Record<string, unknown> }>,
  usageSummaryCalls: [] as Array<{
    connectionId: string;
    period: { startDate: string; endDate: string };
    options?: { forceRefresh?: boolean };
  }>,
  fetchCalls: [] as Array<{
    input: string | URL | Request;
    init?: RequestInit;
  }>,
  storedOAuthState: {
    id: "oauth-state-1",
    userId: "user-test-1",
    provider: "anthropic",
    codeVerifier: "verifier-1",
  },
};

const loggerMock = createLoggerMock();

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getOAuthStateByState: async () => state.storedOAuthState,
    deleteOAuthState: async () => {},
    deactivateConnection: async (id: string) => {
      state.deactivateCalls.push(id);
      return true;
    },
    createConnection: async (input: Record<string, unknown>) => {
      state.createConnectionCalls.push(input);
      return {
        id: "conn-new-oauth",
        provider: input.provider,
        category: input.category,
        scope: input.scope,
        scopeId: input.scopeId,
        createdByUserId: input.createdByUserId,
        name: input.name,
        accountIdentifier: input.accountIdentifier,
        isActive: true,
        isDefault: false,
        config: input.config,
        tokenExpiresAt: input.tokenExpiresAt,
        suspendedAt: null,
        lastUsedAt: null,
        lastValidatedAt: null,
        lastValidationStatus: null,
        lastValidationError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    getConnectionById: async (id: string) => id === "conn-zai"
      ? {
          id,
          provider: "zai",
          category: "ai",
          scope: "organization",
          scopeId: "org-test-1",
          config: {
            zaiPlan: "coding",
            baseUrl: "https://api.z.ai/api/coding/paas/v4",
            implementationModel: "glm-5.2",
          },
        }
      : null,
    updateConnection: async (id: string, input: Record<string, unknown>) => {
      state.updateConnectionCalls.push({ id, input });
      return { id, ...input };
    },
    listConnections: async (filters: {
      category?: string;
      isActive?: boolean;
      scope?: string;
      scopeId?: string;
    }) => {
      if (filters.category !== "ai" || filters.isActive !== true) {
        return [];
      }

      if (filters.scope === "organization" && filters.scopeId === "org-test-1") {
        return [
          {
            id: "conn-org-1",
            provider: "anthropic",
            name: "Org Claude Max",
            accountIdentifier: "org-claude-max",
          },
        ];
      }

      if (filters.scope === "user" && filters.scopeId === "user-test-1") {
        return [
          {
            id: "conn-user-1",
            provider: "openai",
            name: "Personal OpenAI",
            accountIdentifier: "personal-openai",
          },
          {
            id: "conn-fail-1",
            provider: "anthropic",
            name: "Broken Claude",
            accountIdentifier: "broken-claude",
          },
        ];
      }

      return [];
    },
    mapAiProviderToConnectionProvider: (provider: string) => provider,
  }),
);

mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("@almirant/config", () => ({
  ...loggerMock,
  env: {
    ...loggerMock.env,
    ENCRYPTION_KEY: "test-encryption-key",
  },
}));
mock.module("../services/connection-usage-service", () => ({
  connectionUsageService: {
    getConnectionUsage: async (
      connectionId: string,
      _encryptionKey: string,
      period: { startDate: string; endDate: string },
      options?: { forceRefresh?: boolean },
    ) => {
      state.usageSummaryCalls.push({ connectionId, period, options });

      if (connectionId === "conn-fail-1") {
        throw new Error("Provider unavailable");
      }

      return {
        supported: true,
        source: "oauth_usage",
        period,
        totals: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          requests: 0,
        },
        oauthUsage: {
          sevenDay: {
            utilization: connectionId === "conn-org-1" ? 0.62 : 0.41,
            resetsAt: "2026-03-18T00:00:00.000Z",
          },
          extraUsage: {
            isEnabled: false,
            monthlyLimit: 0,
            usedCredits: 0,
            utilization: 0,
            currency: "USD",
          },
        },
      };
    },
  },
}));

const json = (data: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

describe("connectionsRoutes OAuth callback", () => {
  beforeEach(() => {
    state.deactivateCalls = [];
    state.createConnectionCalls = [];
    state.updateConnectionCalls = [];
    state.usageSummaryCalls = [];
    state.fetchCalls = [];

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        state.fetchCalls.push({ input, init });
        return new Response(
          JSON.stringify({
            access_token: "oauth-access-token",
            refresh_token: "oauth-refresh-token",
            expires_in: 3600,
            scope: "user:profile",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    mock.restore();
  });

  it("keeps existing OAuth connections active when adding another Anthropic subscription", async () => {
    const { Elysia } = await import("elysia");
    const { connectionsRoutes } = await import("./connections.routes");
    const app = new Elysia().use(withTestOrg).use(connectionsRoutes);

    const res = await app.handle(
      new Request(
        "http://localhost/connections/oauth/anthropic/callback",
        json({
          code: "manual-code-value",
          state: "oauth-state-token",
          scope: "organization",
          category: "ai",
          name: "Second Claude Max",
        }),
      ),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(state.deactivateCalls).toHaveLength(0);
    expect(state.fetchCalls).toHaveLength(1);
    expect(state.createConnectionCalls).toHaveLength(1);
    expect(state.createConnectionCalls[0]).toMatchObject({
      provider: "anthropic",
      scope: "organization",
      scopeId: "org-test-1",
      name: "Second Claude Max",
      isActive: true,
      config: {
        authMethod: "oauth",
        oauthScopes: "user:profile",
      },
    });
  });

  it("returns usage summary for all visible AI connections and skips failed lookups", async () => {
    const { Elysia } = await import("elysia");
    const { connectionsRoutes } = await import("./connections.routes");
    const app = new Elysia().use(withTestOrg).use(connectionsRoutes);

    const res = await app.handle(
      new Request("http://localhost/connections/usage-summary?forceRefresh=true"),
    );

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: Array<{
        connectionId: string;
        provider: string;
        name: string;
        accountIdentifier: string | null;
        usage: {
          source: string;
          oauthUsage?: { sevenDay?: { utilization: number } };
        };
      }>;
    };

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data).toMatchObject([
      {
        connectionId: "conn-org-1",
        provider: "anthropic",
        name: "Org Claude Max",
        accountIdentifier: "org-claude-max",
        usage: {
          source: "oauth_usage",
          oauthUsage: {
            sevenDay: { utilization: 0.62 },
          },
        },
      },
      {
        connectionId: "conn-user-1",
        provider: "openai",
        name: "Personal OpenAI",
        accountIdentifier: "personal-openai",
        usage: {
          source: "oauth_usage",
          oauthUsage: {
            sevenDay: { utilization: 0.41 },
          },
        },
      },
    ]);

    expect(state.usageSummaryCalls).toHaveLength(3);
    expect(state.usageSummaryCalls.map((call) => call.connectionId)).toEqual([
      "conn-org-1",
      "conn-user-1",
      "conn-fail-1",
    ]);
    expect(
      state.usageSummaryCalls.every(
        (call) =>
          call.options?.forceRefresh === true &&
          call.period.startDate.length === 10 &&
          call.period.endDate.length === 10,
      ),
    ).toBe(true);
  });

  it("canonicalizes entitled Z.AI Coding Plan models before persistence", async () => {
    const { Elysia } = await import("elysia");
    const { connectionsRoutes } = await import("./connections.routes");
    const app = new Elysia().use(withTestOrg).use(connectionsRoutes);

    const res = await app.handle(
      new Request(
        "http://localhost/connections",
        json({
          provider: "zai",
          category: "ai",
          scope: "organization",
          name: "Z.AI Coding Plan",
          config: { baseUrl: "https://api.z.ai/api/coding/paas/v4/" },
          implementationModel: " GLM-5.2 ",
          implementationReasoningBudget: "MAX",
        }),
      ),
    );

    expect(res.status).toBe(201);
    expect(state.createConnectionCalls).toHaveLength(1);
    expect(state.createConnectionCalls[0]?.config).toMatchObject({
      zaiPlan: "coding",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      implementationModel: "glm-5.2",
      implementationReasoningBudget: "max",
    });
  });

  it("rejects API-only and unknown model slugs on both create and update", async () => {
    const { Elysia } = await import("elysia");
    const { connectionsRoutes } = await import("./connections.routes");
    const app = new Elysia().use(withTestOrg).use(connectionsRoutes);

    const createRes = await app.handle(
      new Request(
        "http://localhost/connections",
        json({
          provider: "zai",
          category: "ai",
          scope: "organization",
          name: "Invalid Z.AI",
          implementationModel: "glm-5v-turbo",
        }),
      ),
    );
    const updateRes = await app.handle(
      new Request(
        "http://localhost/connections/conn-zai",
        json({ implementationModel: "totally-not-a-model" }, "PATCH"),
      ),
    );

    expect(createRes.status).toBe(400);
    expect(updateRes.status).toBe(400);
    expect(state.createConnectionCalls).toHaveLength(0);
    expect(state.updateConnectionCalls).toHaveLength(0);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../services/connection-usage-service", () => __real_connectionUsageService);
});
