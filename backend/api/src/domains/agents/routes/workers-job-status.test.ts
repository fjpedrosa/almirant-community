import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
} from "../../../test/mocks";
import { testWorkspace } from "../../../test/fixtures";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_resolveAiKey = { ...(await import("../../ai/shared/services/resolve-ai-key")) };

const state = {
  updateArgs: null as {
    id: string;
    status: string;
    data: Record<string, unknown> | undefined;
  } | null,
};

const existingJob = {
  id: "job-1",
  status: "running" as const,
  workerId: "worker-1",
  workItemId: null,
  planningSessionId: null,
  jobType: "planning" as const,
  createdByUserId: null,
  workspaceId: testWorkspace.id,
  cumulativeDurationMs: 0,
  startedAt: new Date("2026-04-04T12:00:00.000Z"),
  result: null,
  config: {},
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({ id: "worker-api-key", workspaceId: testWorkspace.id }),
  getJobById: async (id: string) => {
    if (id !== existingJob.id) return null;
    return {
      job: existingJob,
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
      createdByUser: null,
    };
  },
  updateJobStatus: async (
    id: string,
    status: string,
    data?: Record<string, unknown>,
  ) => {
    state.updateArgs = { id, status, data };
    return {
      ...existingJob,
      id,
      status,
      result: data?.result ?? null,
      completedAt: status === "completed" || status === "incomplete" ? new Date("2026-04-04T12:10:00.000Z") : null,
      failedAt: status === "failed" ? new Date("2026-04-04T12:10:00.000Z") : null,
    };
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

const makeRequest = (body: unknown): Request =>
  new Request(`http://localhost/workers/jobs/${existingJob.id}/status`, {
    method: "POST",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("workersRoutes POST /workers/jobs/:jobId/status", () => {
  beforeEach(() => {
    state.updateArgs = null;
  });

  it("normalizes legacy string result payloads into an object summary", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "completed",
        result: "plain summary from bridge",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.updateArgs).not.toBeNull();
    expect(state.updateArgs).toMatchObject({
      id: existingJob.id,
      status: "completed",
      data: {
        result: { summary: "plain summary from bridge" },
      },
    });
  });



  it("accepts incomplete as a terminal non-failure status", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "incomplete",
        result: {
          summary: "PR pushed but two tasks were not reconciled",
          completionState: "incomplete",
          missingWorkItemIds: ["wi-1", "wi-2"],
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(state.updateArgs).not.toBeNull();
    expect(state.updateArgs).toMatchObject({
      id: existingJob.id,
      status: "incomplete",
      data: {
        result: {
          summary: "PR pushed but two tasks were not reconciled",
          completionState: "incomplete",
          missingWorkItemIds: ["wi-1", "wi-2"],
        },
      },
    });
    expect(state.updateArgs?.data?.completedAt).toBeInstanceOf(Date);
    expect(state.updateArgs?.data?.failedAt).toBeUndefined();
  });

  it("accepts the new finalizing status for post-session work", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "finalizing",
        result: { summary: "session ended, finalizing push" },
      }),
    );

    expect(res.status).toBe(200);
    expect(state.updateArgs).not.toBeNull();
    expect(state.updateArgs).toMatchObject({
      id: existingJob.id,
      status: "finalizing",
      data: {
        result: { summary: "session ended, finalizing push" },
      },
    });
  });

  it("accepts paused as a non-terminal resource-releasing status", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        status: "paused",
        availableAt: "2026-04-04T13:00:00.000Z",
        errorType: "weekly_quota_exceeded",
        errorMessage: "weekly token limit exceeded",
        result: { pausedForQuota: true },
        branchName: "feature/should-be-cleared",
        worktreePath: "/tmp/should-be-cleared",
      }),
    );

    expect(res.status).toBe(200);
    expect(state.updateArgs).not.toBeNull();
    expect(state.updateArgs).toMatchObject({
      id: existingJob.id,
      status: "paused",
      data: {
        workerId: null,
        branchName: null,
        worktreePath: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorType: "weekly_quota_exceeded",
        errorMessage: "weekly token limit exceeded",
        result: { pausedForQuota: true },
        config: { previousJobId: existingJob.id },
      },
    });
    expect(state.updateArgs?.data?.availableAt).toEqual(new Date("2026-04-04T13:00:00.000Z"));
    expect(state.updateArgs?.data?.cumulativeDurationMs).toBeGreaterThan(0);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
