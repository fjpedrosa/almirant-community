import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createResponseMocks,
  createWsMock,
  createGithubServiceMock,
  restoreRealModules,
} from "../../../test/mocks";
import { testWorkspace, testWorkItem } from "../../../test/fixtures";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──
const __real_resolveAiKey = { ...(await import("../../ai/shared/services/resolve-ai-key")) };

const state = {
  createdJobInput: null as Record<string, unknown> | null,
  forecastCalls: [] as Array<{ workspaceId: string; workItemId: string }>,
};

const orgLookupChain = {
  from: () => orgLookupChain,
  innerJoin: () => orgLookupChain,
  where: () => orgLookupChain,
  limit: async () => [{ workspaceId: testWorkspace.id }],
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({ id: "worker-api-key" }),
  getActiveJobForWorkItem: async () => null,
  createJob: async (input: Record<string, unknown>) => {
    state.createdJobInput = input;
    return {
      id: "job-1",
      status: "queued",
      workItemId: testWorkItem.id,
      planningSessionId: null,
      provider: input.provider,
      jobType: input.jobType ?? "validation",
      priority: input.priority ?? "medium",
      config: input.config ?? {},
      projectId: testWorkItem.projectId,
      boardId: testWorkItem.boardId,
    };
  },
  db: {
    select: () => orgLookupChain,
  },
});

mock.module("@almirant/database", () => dbMocks);
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../services/resource-forecast", () => ({
  buildDefaultJobResourceEstimate: ({ skillName, promptTemplate, jobType }: { skillName?: string | null; promptTemplate?: string | null; jobType?: string | null }) => ({
    estimatedMemoryMb: (promptTemplate ?? skillName ?? jobType) === "runner-implement" ? 3584 : 1536,
    source: "skill-default",
    confidence: "low",
    reason: "Default estimate calculated at enqueue time",
  }),
  buildWorkItemResourceForecast: async (workspaceId: string, workItemId: string) => {
    state.forecastCalls.push({ workspaceId, workItemId });
    return {
      estimatedPeakMemoryMb: 3584,
      confidence: "low",
      bottleneckWave: 1,
      estimatedConcurrentTasks: 5,
    };
  },
  toJobResourceEstimate: (forecast: {
    estimatedPeakMemoryMb: number;
    confidence: "low" | "medium" | "high";
    bottleneckWave?: number;
    estimatedConcurrentTasks: number;
  }) => ({
    estimatedMemoryMb: forecast.estimatedPeakMemoryMb,
    source: "forecast",
    confidence: forecast.confidence,
    reason: `Peak wave ${forecast.bottleneckWave ?? "n/a"} with ${forecast.estimatedConcurrentTasks} concurrent task(s)`,
  }),
}));
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
  new Request("http://localhost/workers/jobs", {
    method: "POST",
    headers: {
      authorization: "Bearer worker-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("workersRoutes POST /workers/jobs", () => {
  beforeEach(() => {
    state.createdJobInput = null;
    state.forecastCalls = [];
  });

  it("creates validation jobs for nightly scheduler with provider defaults", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        workItemId: testWorkItem.id,
        provider: "codex",
        jobType: "validation",
        config: {
          projectId: testWorkItem.projectId,
          skillName: "validate",
          source: "nightly-scheduler",
        },
      })
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; provider: string; jobType: string };
    };

    expect(body.success).toBe(true);
    expect(body.data.id).toBe("job-1");
    expect(state.createdJobInput).toMatchObject({
      projectId: testWorkItem.projectId,
      boardId: testWorkItem.boardId,
      workItemId: testWorkItem.id,
      workspaceId: testWorkspace.id,
      provider: "codex",
      jobType: "validation",
      priority: "medium",
      config: {
        repoPath: ".",
        baseBranch: "main",
        projectId: testWorkItem.projectId,
        skillName: "validate",
        source: "nightly-scheduler",
        resourceEstimate: {
          estimatedMemoryMb: 1536,
          source: "skill-default",
          confidence: "low",
          reason: "Default estimate calculated at enqueue time",
        },
      },
    });
  });

  it("persists a resource forecast for implementation jobs created by workers", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest({
        workItemId: testWorkItem.id,
        provider: "zipu",
        jobType: "implementation",
        config: {
          projectId: testWorkItem.projectId,
          skillName: "runner-implement",
          source: "backlog-drain",
        },
      })
    );

    expect(res.status).toBe(201);
    expect(state.forecastCalls).toEqual([
      {
        workspaceId: testWorkspace.id,
        workItemId: testWorkItem.id,
      },
    ]);
    expect(state.createdJobInput).toMatchObject({
      jobType: "implementation",
      config: {
        source: "backlog-drain",
        skillName: "runner-implement",
        resourceEstimate: {
          estimatedMemoryMb: 3584,
          source: "forecast",
          confidence: "low",
          reason: "Peak wave 1 with 5 concurrent task(s)",
        },
      },
    });
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
