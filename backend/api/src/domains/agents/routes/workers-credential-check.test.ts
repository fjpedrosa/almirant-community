import { afterAll, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createLoggerMock,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
} from "../../../test/mocks";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_resolveAiKey = { ...(await import("../../ai/shared/services/resolve-ai-key")) };

const SERVICE_ACCOUNT_KEY = "alm_sa_test-service-account";
const LEGACY_USER_KEY = "alm_k1_test-legacy-user";

const dbMocks = createDatabaseMocks({
  validateApiKey: async (rawKey: string) => {
    if (rawKey === SERVICE_ACCOUNT_KEY) {
      return {
        id: "sa-key-1",
        userId: null,
        serviceAccountId: "sa-1",
        workspaceId: "org-1",
      };
    }
    if (rawKey === LEGACY_USER_KEY) {
      return {
        id: "user-key-1",
        userId: "user-1",
        serviceAccountId: null,
        workspaceId: "org-1",
      };
    }
    return null;
  },
});

mock.module("@almirant/database", () => dbMocks);
const loggerMocks = createLoggerMock();
mock.module("@almirant/config", () => loggerMocks);
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../ai/shared/services/resolve-ai-key", () => ({
  resolveAiKey: async () => null,
  refreshConnectionCredentialsIfNeeded: async (
    _connection: Record<string, unknown>,
    _encryptionKey: string,
    credentials?: Record<string, unknown>,
  ) => credentials ?? { apiKey: "refreshed-fallback-key" },
}));
mock.module("../../integrations/github/services/github-service", () => createGithubServiceMock({
  getInstallationAccessToken: async () => "gh-token",
  fetchFromGithub: async () => ({}),
}));

const makeRequest = (authorization?: string): Request =>
  new Request("http://localhost/workers/credential-check", {
    method: "GET",
    headers: authorization ? { authorization } : {},
  });

describe("workersRoutes GET /workers/credential-check", () => {
  it("returns success when the credential resolves to a valid service account", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest(`Bearer ${SERVICE_ACCOUNT_KEY}`));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { authenticated: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.authenticated).toBe(true);
  });

  it("fails closed with 403 on a legacy (non-service-account) user key", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest(`Bearer ${LEGACY_USER_KEY}`));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  it("fails with 401 when the Authorization header is missing", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest());

    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  it("fails with 401 when the credential does not validate", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest("Bearer alm_sa_does-not-exist"));

    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
