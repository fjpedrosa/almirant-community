import { describe, expect, it, mock, afterAll } from "bun:test";
import { createLoggerMock, restoreRealModules } from "../../test/mocks";

const configMock = createLoggerMock();

mock.module("@almirant/config", () => ({
  ...configMock,
  env: {
    ...configMock.env,
    ENCRYPTION_KEY: "test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
}));

// ── Mutable mock state for validateApiKey ────────────────────────────────────
// Tests override this via `validateApiKeyResult` to simulate different API key rows.
let validateApiKeyResult: unknown = null;

mock.module("@almirant/database", () => ({
  validateApiKey: async () => validateApiKeyResult,
  resolveProjectOrganization: async () => null,
}));

// ── Helper: build a fake API key row ─────────────────────────────────────────
const buildApiKeyRow = (overrides: Record<string, unknown> = {}) => ({
  id: "key-1",
  name: "test-key",
  keyHash: "abc123",
  keyPrefix: "alm_k1_abc",
  isActive: true,
  userId: "user-1",
  serviceAccountId: null,
  organizationId: "org-1",
  allowedIssuedPermissions: ["mcp:read", "mcp:write"],
  lastUsedAt: null,
  createdAt: new Date("2025-01-01"),
  ...overrides,
});

describe("createMcpAuthenticator session-token user propagation", () => {
  it("exposes userId from session tokens in authInfo.extra", async () => {
    const [{ createMcpAuthenticator }, { generateSessionToken }] = await Promise.all([
      import("./authenticate"),
      import("../../shared/services/session-token"),
    ]);

    const token = generateSessionToken({
      projectId: "proj-1",
      organizationId: "org-1",
      userId: "auto-fix-bot",
      permissions: ["mcp:read", "mcp:write"],
      signingSecret:
        "test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    });

    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: null,
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp?projectId=proj-1", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      }),
    });

    expect(result).toHaveProperty("authInfo");
    expect(result.authInfo?.extra?.userId).toBe("auto-fix-bot");
  });

  it("exposes jobId from session tokens in authInfo.extra so complete_ai_task can persist agent_job_id", async () => {
    const [{ createMcpAuthenticator }, { generateSessionToken }] = await Promise.all([
      import("./authenticate"),
      import("../../shared/services/session-token"),
    ]);

    const jobId = "80b8f8ec-4eb9-43e6-a325-9bdf58e5c2a5";
    const token = generateSessionToken({
      projectId: "proj-1",
      organizationId: "org-1",
      jobId,
      permissions: ["mcp:read", "mcp:write"],
      signingSecret:
        "test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    });

    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: null,
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp?projectId=proj-1", {
        headers: { authorization: `Bearer ${token}` },
      }),
    });

    expect(result).toHaveProperty("authInfo");
    expect(result.authInfo?.extra?.jobId).toBe(jobId);
  });

  it("accepts organization-scoped session tokens without projectId for ChatGPT MCP connectors", async () => {
    const [{ createMcpAuthenticator }, { generateSessionToken }] = await Promise.all([
      import("./authenticate"),
      import("../../shared/services/session-token"),
    ]);

    const token = generateSessionToken({
      organizationId: "org-1",
      userId: "user-1",
      permissions: ["mcp:read", "mcp:write"],
      signingSecret:
        "test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    });

    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: null,
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp", {
        headers: { authorization: `Bearer ${token}` },
      }),
    });

    expect(result).toHaveProperty("authInfo");
    expect(result.authInfo?.extra?.organizationId).toBe("org-1");
    expect(result.authInfo?.extra?.projectId).toBeUndefined();
  });
});

describe("createMcpAuthenticator legacy MCP OAuth control-plane redirects", () => {
  it("redirects cached legacy authorize URLs before requiring a bearer token", async () => {
    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: null,
    });

    const result = await authenticate({
      request: new Request(
        "https://almirant.example/api/mcp/oauth/authorize?response_type=code&state=s1",
      ),
    });

    expect(result).toHaveProperty("response");
    expect(result.response?.status).toBe(302);
    expect(result.response?.headers.get("location")).toBe(
      "https://almirant.example/api/oauth/mcp/authorize?response_type=code&state=s1",
    );
  });

  it("redirects cached legacy registration POSTs preserving method and body semantics", async () => {
    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: null,
    });

    const result = await authenticate({
      request: new Request("https://almirant.example/api/mcp/oauth/register", {
        method: "POST",
      }),
    });

    expect(result).toHaveProperty("response");
    expect(result.response?.status).toBe(307);
    expect(result.response?.headers.get("location")).toBe(
      "https://almirant.example/api/oauth/mcp/register",
    );
  });
});

describe("createMcpAuthenticator API key permissions", () => {
  it("uses default permissions when allowedIssuedPermissions has values", async () => {
    validateApiKeyResult = buildApiKeyRow({
      allowedIssuedPermissions: ["mcp:read", "mcp:write"],
    });

    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: null,
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp", {
        headers: { authorization: "Bearer alm_k1_testapikey" },
      }),
    });

    expect(result).toHaveProperty("authInfo");
    expect(result.authInfo?.extra?.permissions).toEqual(["mcp:read", "mcp:write"]);
  });

  it("falls back to DEFAULT_API_KEY_PERMISSIONS when allowedIssuedPermissions is empty", async () => {
    validateApiKeyResult = buildApiKeyRow({
      allowedIssuedPermissions: [],
    });

    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: null,
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp", {
        headers: { authorization: "Bearer alm_k1_testapikey" },
      }),
    });

    expect(result).toHaveProperty("authInfo");
    expect(result.authInfo?.extra?.permissions).toEqual(["mcp:read", "mcp:write"]);
  });

  it("reads custom permissions including mcp:internal from the API key row", async () => {
    validateApiKeyResult = buildApiKeyRow({
      allowedIssuedPermissions: ["mcp:read", "mcp:write", "mcp:internal"],
    });

    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: null,
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp", {
        headers: { authorization: "Bearer alm_k1_testapikey" },
      }),
    });

    expect(result).toHaveProperty("authInfo");
    expect(result.authInfo?.extra?.permissions).toEqual(["mcp:read", "mcp:write", "mcp:internal"]);
  });

  it("returns 401 when requiredPermission is set but API key lacks it", async () => {
    validateApiKeyResult = buildApiKeyRow({
      allowedIssuedPermissions: ["mcp:read", "mcp:write"],
    });

    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: "mcp:internal",
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp", {
        headers: { authorization: "Bearer alm_k1_testapikey" },
      }),
    });

    expect(result).toHaveProperty("response");
    expect(result.response?.status).toBe(401);
    const body = (await result.response!.json()) as { error: { message: string } };
    expect(body.error.message).toContain("API key missing required permission");
  });

  it("allows access when requiredPermission is present in API key permissions", async () => {
    validateApiKeyResult = buildApiKeyRow({
      allowedIssuedPermissions: ["mcp:read", "mcp:write", "mcp:internal"],
    });

    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: "mcp:internal",
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp", {
        headers: { authorization: "Bearer alm_k1_testapikey" },
      }),
    });

    expect(result).toHaveProperty("authInfo");
    expect(result.authInfo?.extra?.permissions).toContain("mcp:internal");
  });

  it("filters out invalid/unknown permissions (defense in depth)", async () => {
    validateApiKeyResult = buildApiKeyRow({
      allowedIssuedPermissions: ["mcp:read", "mcp:write", "mcp:admin", "mcp:superuser"],
    });

    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: null,
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp", {
        headers: { authorization: "Bearer alm_k1_testapikey" },
      }),
    });

    expect(result).toHaveProperty("authInfo");
    // Only recognized permissions survive the filter
    expect(result.authInfo?.extra?.permissions).toEqual(["mcp:read", "mcp:write"]);
  });

  it("returns 401 when all permissions are invalid and requiredPermission is set", async () => {
    validateApiKeyResult = buildApiKeyRow({
      allowedIssuedPermissions: ["mcp:admin", "mcp:superuser"],
    });

    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: "mcp:read",
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp", {
        headers: { authorization: "Bearer alm_k1_testapikey" },
      }),
    });

    expect(result).toHaveProperty("response");
    expect(result.response?.status).toBe(401);
    const body = (await result.response!.json()) as { error: { message: string } };
    expect(body.error.message).toContain("API key missing required permission");
  });

  it("propagates apiKeyId, apiKeyName, and userId in authInfo.extra", async () => {
    validateApiKeyResult = buildApiKeyRow({
      id: "key-custom",
      name: "my-agent-key",
      userId: "user-42",
      allowedIssuedPermissions: ["mcp:read"],
    });

    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator({
      allowApiKeys: true,
      requiredPermission: null,
    });

    const result = await authenticate({
      request: new Request("http://localhost/mcp", {
        headers: { authorization: "Bearer alm_k1_testapikey" },
      }),
    });

    expect(result).toHaveProperty("authInfo");
    const extra = result.authInfo?.extra as
      | { apiKeyId?: string; apiKeyName?: string; userId?: string }
      | undefined;
    expect(extra?.apiKeyId).toBe("key-custom");
    expect(extra?.apiKeyName).toBe("my-agent-key");
    expect(extra?.userId).toBe("user-42");
  });
});

describe("createMcpAuthenticator internal mount authorization", () => {
  const internalConfig = { allowApiKeys: false, requiredPermission: "mcp:internal" } as const;

  it("rejects session token without mcp:internal on internal mount", async () => {
    const [{ createMcpAuthenticator }, { generateSessionToken }] = await Promise.all([
      import("./authenticate"),
      import("../../shared/services/session-token"),
    ]);

    const token = generateSessionToken({
      projectId: "proj-1",
      organizationId: "org-1",
      userId: "user-1",
      permissions: ["mcp:read", "mcp:write"],
      signingSecret:
        "test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    });

    const authenticate = createMcpAuthenticator(internalConfig);

    const result = await authenticate({
      request: new Request("http://localhost/mcp/internal", {
        headers: { authorization: `Bearer ${token}` },
      }),
    });

    expect(result).toHaveProperty("response");
    expect(result.response?.status).toBe(401);
    const body = (await result.response!.json()) as { error: { message: string } };
    expect(body.error.message).toContain("missing required permission");
  });

  it("accepts session token with mcp:internal on internal mount", async () => {
    const [{ createMcpAuthenticator }, { generateSessionToken }] = await Promise.all([
      import("./authenticate"),
      import("../../shared/services/session-token"),
    ]);

    const token = generateSessionToken({
      projectId: "proj-1",
      organizationId: "org-1",
      userId: "user-1",
      permissions: ["mcp:read", "mcp:write", "mcp:internal"],
      signingSecret:
        "test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    });

    const authenticate = createMcpAuthenticator(internalConfig);

    const result = await authenticate({
      request: new Request("http://localhost/mcp/internal", {
        headers: { authorization: `Bearer ${token}` },
      }),
    });

    expect(result).toHaveProperty("authInfo");
    expect(result.authInfo?.extra?.permissions).toContain("mcp:internal");
  });

  it("rejects API key on internal mount regardless of permissions", async () => {
    validateApiKeyResult = buildApiKeyRow({
      allowedIssuedPermissions: ["mcp:read", "mcp:write", "mcp:internal"],
    });

    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator(internalConfig);

    const result = await authenticate({
      request: new Request("http://localhost/mcp/internal", {
        headers: { authorization: "Bearer alm_k1_testapikey" },
      }),
    });

    expect(result).toHaveProperty("response");
    expect(result.response?.status).toBe(401);
    const body = (await result.response!.json()) as { error: { message: string } };
    expect(body.error.message).toContain("API keys are not accepted");
  });

  it("rejects request without bearer token on internal mount", async () => {
    const { createMcpAuthenticator } = await import("./authenticate");
    const authenticate = createMcpAuthenticator(internalConfig);

    const result = await authenticate({
      request: new Request("http://localhost/mcp/internal"),
    });

    expect(result).toHaveProperty("response");
    expect(result.response?.status).toBe(401);
    const body = (await result.response!.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Missing Bearer token");
  });
});

afterAll(() => {
  validateApiKeyResult = null;
  mock.restore();
  restoreRealModules();
});
