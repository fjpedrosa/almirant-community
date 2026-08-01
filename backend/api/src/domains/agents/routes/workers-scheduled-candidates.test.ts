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
  // configId -> scheduled agent config (each one owned by a specific workspace)
  configsById: new Map<string, { id: string; workspaceId: string }>(),
  backlogDrainLookups: [] as Array<{ configId: string; workspaceId?: string }>,
  backlogCandidatesByConfigId: new Map<string, Array<Record<string, unknown>>>(),
  dodReviewCandidateCalls: [] as Array<{
    workspaceId: string;
    projectId?: string;
    limit?: number;
    minAgeMinutes?: number;
  }>,
  dodReviewCandidatesByWorkspaceId: new Map<string, Array<Record<string, unknown>>>(),
};

const dbMocks = createDatabaseMocks({
  // The worker API key always belongs to workspace A (testWorkspace). Every
  // scenario below exercises a scheduled agent config that lives in
  // workspace B (testWorkspaceB) to prove tenancy comes from the config,
  // never from the caller's own key.
  validateApiKey: async () => ({ id: "worker-api-key", workspaceId: testWorkspace.id }),

  // Mirrors the real repository: workspaceId is optional; when provided the
  // lookup is scoped to it, exactly like the SQL `WHERE id = ? AND
  // workspace_id = ?` this replaces. This lets the test go red if the route
  // ever regresses to passing the worker key's workspace again.
  getBacklogDrainCandidatesForConfigId: async (configId: string, workspaceId?: string) => {
    state.backlogDrainLookups.push({ configId, workspaceId });
    const config = state.configsById.get(configId);
    if (!config) return null;
    if (workspaceId && config.workspaceId !== workspaceId) return null;
    return {
      candidates: state.backlogCandidatesByConfigId.get(configId) ?? [],
      skipped: {},
    };
  },

  getScheduledAgentConfigByIdUnscoped: async (id: string) => state.configsById.get(id),

  getDefinitionOfDoneReviewCandidates: async (
    workspaceId: string,
    projectId?: string,
    limit?: number,
    options?: { minAgeMinutes?: number },
  ) => {
    state.dodReviewCandidateCalls.push({
      workspaceId,
      projectId,
      limit,
      minAgeMinutes: options?.minAgeMinutes,
    });
    return state.dodReviewCandidatesByWorkspaceId.get(workspaceId) ?? [];
  },
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

const authedRequest = (path: string): Request =>
  new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { authorization: "Bearer worker-secret" },
  });

describe("workersRoutes GET /workers/backlog-drain-candidates", () => {
  beforeEach(() => {
    state.configsById = new Map();
    state.backlogDrainLookups = [];
    state.backlogCandidatesByConfigId = new Map();
  });

  it("resolves candidates by the scheduled config's own workspace, not the worker key's", async () => {
    state.configsById.set("cfg-b", { id: "cfg-b", workspaceId: testWorkspaceB.id });
    state.backlogCandidatesByConfigId.set("cfg-b", [{ id: "work-item-b" }]);

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(authedRequest("/workers/backlog-drain-candidates?configId=cfg-b"));
    const body = (await res.json()) as {
      success: boolean;
      data: { candidates: Array<{ id: string }> };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.candidates).toEqual([{ id: "work-item-b" }]);
    // The route must resolve by id alone — no workspaceId argument at all.
    expect(state.backlogDrainLookups).toEqual([{ configId: "cfg-b", workspaceId: undefined }]);
  });

  it("404s when the configId does not exist in any workspace", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(authedRequest("/workers/backlog-drain-candidates?configId=missing"));

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      success: false,
      error: expect.stringMatching(/not found/i),
    });
  });
});

describe("workersRoutes GET /workers/dod-review-candidates", () => {
  beforeEach(() => {
    state.configsById = new Map();
    state.dodReviewCandidateCalls = [];
    state.dodReviewCandidatesByWorkspaceId = new Map();
  });

  it("uses the scheduled config's workspace when scheduledConfigId is provided", async () => {
    state.configsById.set("cfg-b", { id: "cfg-b", workspaceId: testWorkspaceB.id });
    state.dodReviewCandidatesByWorkspaceId.set(testWorkspaceB.id, [{ id: "work-item-b" }]);

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      authedRequest("/workers/dod-review-candidates?scheduledConfigId=cfg-b&projectId=proj-b"),
    );
    const body = (await res.json()) as { success: boolean; data: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ id: "work-item-b" }]);
    expect(state.dodReviewCandidateCalls).toEqual([
      { workspaceId: testWorkspaceB.id, projectId: "proj-b", limit: undefined, minAgeMinutes: undefined },
    ]);
  });

  it("falls back to the worker key's workspace when scheduledConfigId is omitted", async () => {
    state.dodReviewCandidatesByWorkspaceId.set(testWorkspace.id, [{ id: "work-item-a" }]);

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(authedRequest("/workers/dod-review-candidates?projectId=proj-a"));
    const body = (await res.json()) as { success: boolean; data: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(body.data).toEqual([{ id: "work-item-a" }]);
    expect(state.dodReviewCandidateCalls).toEqual([
      { workspaceId: testWorkspace.id, projectId: "proj-a", limit: undefined, minAgeMinutes: undefined },
    ]);
  });

  it("404s when scheduledConfigId is provided but does not resolve", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      authedRequest("/workers/dod-review-candidates?scheduledConfigId=missing"),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      success: false,
      error: expect.stringMatching(/not found/i),
    });
    expect(state.dodReviewCandidateCalls).toEqual([]);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
