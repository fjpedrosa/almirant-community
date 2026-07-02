import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
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
const __realConfig = { ...(await import("@almirant/config")) };

const state = {
  queuedCount: 0,
  executingCount: 0,
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({ id: "worker-api-key" }),
  getQueuedJobCount: async () => state.queuedCount,
  getExecutingJobCount: async () => state.executingCount,
});

mock.module("@almirant/database", () => dbMocks);
const loggerMocks = createLoggerMock();
mock.module("@almirant/config", () => ({
  ...loggerMocks,
  env: {
    ...loggerMocks.env,
    // Configurable spare capacity for the scaler (default is 1 via env schema).
    SCALING_MIN_AVAILABLE_SLOTS: 2,
  },
}));
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
  new Request("http://localhost/workers/scaling-metric", {
    method: "GET",
    headers: {
      authorization: "Bearer worker-secret",
    },
  });

describe("workersRoutes GET /workers/scaling-metric", () => {
  beforeEach(() => {
    state.queuedCount = 0;
    state.executingCount = 0;
  });

  it("returns targetCapacity = queueDepth + activeJobs + minAvailableSlots", async () => {
    state.queuedCount = 3;
    state.executingCount = 4;

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { targetCapacity: number };
    };

    expect(body.success).toBe(true);
    // 3 queued + 4 executing + 2 minAvailableSlots (mocked env)
    expect(body.data.targetCapacity).toBe(9);
  });

  it("keeps min available slots when the queue is empty and nothing runs", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { targetCapacity: number };
    };

    expect(body.data.targetCapacity).toBe(2);
  });

  it("defaults SCALING_MIN_AVAILABLE_SLOTS to 1 in the env schema", () => {
    // The test process does not set SCALING_MIN_AVAILABLE_SLOTS, so the real
    // (unmocked) config must resolve the documented default of 1.
    expect(__realConfig.env.SCALING_MIN_AVAILABLE_SLOTS).toBe(1);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
