import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
} from "../../../test/mocks";
import { testWorkspace, testWorkspaceB } from "../../../test/fixtures";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_resolveAiKey = { ...(await import("../../ai/shared/services/resolve-ai-key")) };

const state = {
  // Deliberately spans two different workspaces — the whole point of this
  // endpoint being global is that the runner (one worker API key, one
  // workspace) must still see every other workspace's enabled configs.
  enabledConfigs: [] as Array<Record<string, unknown>>,
};

const dbMocks = createDatabaseMocks({
  // The worker API key belongs to workspace A (testWorkspace). The endpoint
  // must NOT filter listEnabledScheduledAgentConfigs() by this workspace.
  validateApiKey: async () => ({ id: "worker-api-key", workspaceId: testWorkspace.id }),
  listEnabledScheduledAgentConfigs: async () => state.enabledConfigs,
});

mock.module("@almirant/database", () => dbMocks);
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

const makeRequest = (): Request =>
  new Request("http://localhost/workers/scheduled-configs", {
    method: "GET",
    headers: {
      authorization: "Bearer worker-secret",
    },
  });

describe("workersRoutes GET /workers/scheduled-configs", () => {
  beforeEach(() => {
    state.enabledConfigs = [];
  });

  it("returns enabled configs from every workspace, not just the worker key's own", async () => {
    state.enabledConfigs = [
      { id: "cfg-a", workspaceId: testWorkspace.id, name: "Config A" },
      { id: "cfg-b", workspaceId: testWorkspaceB.id, name: "Config B" },
    ];

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest());
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string; workspaceId: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Both configs come back even though the key belongs to testWorkspace —
    // the runner is shared instance infrastructure, same as /workers/jobs/claim.
    expect(body.data.map((c) => c.id).sort()).toEqual(["cfg-a", "cfg-b"]);
    expect(body.data.find((c) => c.id === "cfg-b")?.workspaceId).toBe(testWorkspaceB.id);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
