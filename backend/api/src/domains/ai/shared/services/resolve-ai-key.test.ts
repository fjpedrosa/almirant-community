import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as database from "@almirant/database";
import { env } from "@almirant/config";
import * as openaiTokenExchange from "../../../connections/services/oauth/openai-token-exchange";

// ---------------------------------------------------------------------------
// State used to drive the spied functions
// ---------------------------------------------------------------------------

const state = {
  policy: "user_preferred",
  mapCalls: [] as string[],
  findCalls: [] as Array<{ provider: string; scope: string; scopeId: string }>,
  connections: new Map<
    string,
    {
      id: string;
      provider?: string;
      category?: string;
      scope?: string;
      scopeId?: string;
      tokenExpiresAt?: string | null;
      config?: Record<string, unknown>;
      isActive?: boolean;
    }
  >(),
  decryptedCredentials: new Map<string, Record<string, unknown>>(),
  updatedCredentials: [] as Array<{
    id: string;
    credentials: Record<string, unknown>;
    tokenExpiresAt: Date | null;
  }>,
  deactivatedIds: [] as string[],
  refreshTokenCalls: [] as string[],
};

const originalFetch = globalThis.fetch;

// ---------------------------------------------------------------------------
// Spies — set up once at module scope
// ---------------------------------------------------------------------------

spyOn(database, "getOrgSettings").mockImplementation(
  (async () => ({ aiKeyPolicy: state.policy })) as never,
);

spyOn(database, "mapAiProviderToConnectionProvider").mockImplementation(
  ((provider: string) => {
    state.mapCalls.push(provider);
    if (provider === "zai") return "openai_compatible";
    if (provider === "openai-compatible") return "openai_compatible";
    return provider;
  }) as never,
);

spyOn(database, "findActiveConnections").mockImplementation(
  (async (provider: string, scope: string, scopeId: string) => {
    state.findCalls.push({ provider, scope, scopeId });
    const connection = state.connections.get(`${provider}:${scope}:${scopeId}`);
    return connection ? [connection] : [];
  }) as never,
);

spyOn(database, "mapConnectionProviderToAiProvider").mockImplementation(
  ((provider: string) => provider) as never,
);

// Return the same fake connection object for re-reads during refresh
spyOn(database, "getAiProviderKeyById").mockImplementation(
  (async (id: string) => {
    // Find the connection in state by ID
    for (const conn of state.connections.values()) {
      if (conn.id === id) return conn;
    }
    return null;
  }) as never,
);

spyOn(database, "decryptCredentials").mockImplementation(
  ((connection: { id: string }) =>
    state.decryptedCredentials.get(connection.id) ?? {
      apiKey: `key-${connection.id}`,
    }) as never,
);

spyOn(database, "updateAiProviderKeyCredentials").mockImplementation(
  (async (
    id: string,
    payload: { credentials: Record<string, unknown>; tokenExpiresAt: Date | null },
  ) => {
    state.updatedCredentials.push({ id, ...payload });
    return null;
  }) as never,
);

spyOn(database, "deactivateConnection").mockImplementation(
  (async (id: string) => {
    state.deactivatedIds.push(id);
    return true;
  }) as never,
);

const exchangeIdTokenForApiKeySpy = spyOn(
  openaiTokenExchange,
  "exchangeIdTokenForApiKey",
);

// Ensure ENCRYPTION_KEY is set (the source reads it from env).
(env as Record<string, unknown>).ENCRYPTION_KEY = "test-encryption-key";

describe("resolveAiKey", () => {
  beforeEach(() => {
    state.policy = "user_preferred";
    state.mapCalls = [];
    state.findCalls = [];
    state.connections = new Map();
    state.decryptedCredentials = new Map();
    state.updatedCredentials = [];
    state.deactivatedIds = [];
    state.refreshTokenCalls = [];
    exchangeIdTokenForApiKeySpy.mockReset();
    exchangeIdTokenForApiKeySpy.mockResolvedValue("exchanged-openai-api-key");
    globalThis.fetch = mock(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const body =
          typeof init?.body === "string"
            ? init.body.trim().startsWith("{")
              ? JSON.parse(init.body)
              : Object.fromEntries(new URLSearchParams(init.body))
            : null;
        const refreshToken =
          body && typeof body.refresh_token === "string"
            ? body.refresh_token
            : "";

        state.refreshTokenCalls.push(refreshToken);

        if (refreshToken === "refresh-fails") {
          return new Response("refresh failed", {
            status: 400,
            headers: { "Content-Type": "text/plain" },
          });
        }

        return new Response(
          JSON.stringify({
            access_token: `refreshed-${refreshToken}`,
            refresh_token: `${refreshToken}-next`,
            expires_in: 3600,
            scope: "test-scope",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("respects user_preferred policy order", async () => {
    state.connections.set("openai:user:user-1", { id: "conn-user" });
    state.connections.set("openai:organization:org-1", { id: "conn-org" });

    const { resolveAiKey } = await import("./resolve-ai-key");
    const resolved = await resolveAiKey({
      provider: "openai",
      userId: "user-1",
      organizationId: "org-1",
      encryptionKey: "enc-key",
    });

    expect(resolved?.connection.id).toBe("conn-user");
    expect(state.findCalls[0]).toMatchObject({
      provider: "openai",
      scope: "user",
      scopeId: "user-1",
    });
  });

  it("respects org_only policy and does not query user scope", async () => {
    state.policy = "org_only";
    state.connections.set("anthropic:organization:org-1", {
      id: "conn-org-only",
    });

    const { resolveAiKey } = await import("./resolve-ai-key");
    const resolved = await resolveAiKey({
      provider: "anthropic",
      userId: "user-1",
      organizationId: "org-1",
      encryptionKey: "enc-key",
    });

    expect(resolved?.connection.id).toBe("conn-org-only");
    expect(state.findCalls).toHaveLength(1);
    expect(state.findCalls[0]).toMatchObject({
      provider: "anthropic",
      scope: "organization",
      scopeId: "org-1",
    });
  });

  it("falls back to organization scope when policy prefers user but no userId is available", async () => {
    state.connections.set("openai:organization:org-1", {
      id: "conn-org-fallback",
    });

    const { resolveAiKey } = await import("./resolve-ai-key");
    const resolved = await resolveAiKey({
      provider: "openai",
      userId: null,
      organizationId: "org-1",
      encryptionKey: "enc-key",
    });

    expect(resolved?.connection.id).toBe("conn-org-fallback");
    expect(state.findCalls).toEqual([
      {
        provider: "openai",
        scope: "organization",
        scopeId: "org-1",
      },
    ]);
  });

  it("maps zai provider to openai_compatible", async () => {
    state.policy = "org_only";
    state.connections.set("openai_compatible:organization:org-1", {
      id: "conn-zai",
    });

    const { resolveAiKey } = await import("./resolve-ai-key");
    const resolved = await resolveAiKey({
      provider: "zai",
      userId: "user-1",
      organizationId: "org-1",
      encryptionKey: "enc-key",
    });

    expect(state.mapCalls).toEqual(["zai"]);
    expect(state.findCalls[0]).toMatchObject({
      provider: "openai_compatible",
      scope: "organization",
      scopeId: "org-1",
    });
    expect(resolved?.connection.id).toBe("conn-zai");
  });

  it("refreshes expired oauth credentials via centralized token-refresh", async () => {
    // Set up a connection with expired token and a refresh token
    const connId = "conn-expired-oauth";
    const expiredConn = {
      id: connId,
      provider: "anthropic",
      category: "ai",
      scope: "organization",
      scopeId: "org-1",
      tokenExpiresAt: "2026-03-10T09:00:00.000Z",
      config: { authMethod: "oauth" },
      isActive: true,
    };
    state.connections.set("anthropic:organization:org-1", expiredConn);
    state.decryptedCredentials.set(connId, {
      apiKey: "expired-token",
      authMethod: "oauth",
      refreshToken: "refresh-1",
    });

    // Mock fetch for the Anthropic token endpoint
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "refreshed-access",
            refresh_token: "refresh-1-next",
            expires_in: 3600,
            scope: "user:profile",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("NOT_FOUND", { status: 404 });
    }) as unknown as typeof fetch;

    const { resolveAiKey } = await import("./resolve-ai-key");
    const resolved = await resolveAiKey({
      provider: "anthropic",
      userId: "user-1",
      organizationId: "org-1",
      encryptionKey: "enc-key",
    });

    expect(resolved?.connection.id).toBe(connId);
    expect(resolved?.credentials.apiKey).toBe("refreshed-access");
    expect(state.updatedCredentials).toHaveLength(1);
    expect(state.updatedCredentials[0]?.id).toBe(connId);
    expect(state.deactivatedIds).toHaveLength(0);
  });

  it("returns user credentials as-is when oauth refresh fails instead of deactivating", async () => {
    state.connections.set("anthropic:user:user-1", {
      id: "conn-user-expired",
      provider: "anthropic",
      category: "ai",
      tokenExpiresAt: "2026-03-10T09:00:00.000Z",
      config: { authMethod: "oauth" },
      isActive: true,
    });
    state.connections.set("anthropic:organization:org-1", {
      id: "conn-org-valid",
      provider: "anthropic",
      category: "ai",
      tokenExpiresAt: null,
      config: { authMethod: "api_key" },
      isActive: true,
    });
    state.decryptedCredentials.set("conn-user-expired", {
      apiKey: "expired-token",
      authMethod: "oauth",
      refreshToken: "refresh-fails",
    });
    state.decryptedCredentials.set("conn-org-valid", {
      apiKey: "org-key",
      authMethod: "api_key",
    });

    const { resolveAiKey } = await import("./resolve-ai-key");
    const resolved = await resolveAiKey({
      provider: "anthropic",
      userId: "user-1",
      organizationId: "org-1",
      encryptionKey: "enc-key",
    });

    // Should return the user connection with existing credentials (not deactivate & fallback)
    expect(resolved?.connection.id).toBe("conn-user-expired");
    expect(resolved?.credentials.apiKey).toBe("expired-token");
    expect(state.deactivatedIds).toHaveLength(0);
  });

  it("refreshes OpenAI oauth credentials when oauthAccessToken JWT is expired even if tokenExpiresAt is later", async () => {
    const connId = "conn-openai-split";
    state.connections.set("openai:organization:org-1", {
      id: connId,
      provider: "openai",
      category: "ai",
      scope: "organization",
      scopeId: "org-1",
      tokenExpiresAt: "2026-04-22T17:47:39.000Z",
      config: { authMethod: "oauth" },
      isActive: true,
    });

    const exp = Math.floor(Date.parse("2026-04-12T17:51:31.000Z") / 1000);
    const expiredOauthToken = `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.sig`;

    state.decryptedCredentials.set(connId, {
      apiKey: "fresh-looking-api-key",
      oauthAccessToken: expiredOauthToken,
      authMethod: "oauth",
      refreshToken: "refresh-openai",
      idToken: "existing-id-token",
    });

    const { resolveAiKey } = await import("./resolve-ai-key");
    const resolved = await resolveAiKey({
      provider: "openai",
      userId: "user-1",
      organizationId: "org-1",
      encryptionKey: "enc-key",
    });

    expect(resolved?.connection.id).toBe(connId);
    expect(state.refreshTokenCalls).toEqual(["refresh-openai"]);
    expect(state.updatedCredentials).toHaveLength(1);
    expect(state.updatedCredentials[0]?.credentials).toMatchObject({
      apiKey: "exchanged-openai-api-key",
      oauthAccessToken: "refreshed-refresh-openai",
      refreshToken: "refresh-openai-next",
      authMethod: "oauth",
    });
  });
});
