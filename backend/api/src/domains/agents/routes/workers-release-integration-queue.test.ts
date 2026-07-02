import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
} from "../../../test/mocks";
import { testIntegrationBatch, testWorkspace, testProject, testRepository } from "../../../test/fixtures";

const __real_resolveAiKey = { ...(await import("../../ai/shared/services/resolve-ai-key")) };

const state = {
  createdBatches: [] as Array<Record<string, unknown>>,
  addedItems: [] as Array<Record<string, unknown>>,
  createdJobs: [] as Array<Record<string, unknown>>,
  updatedBatchStatuses: [] as Array<{ id: string; status: string }>,
  activeBatchItemCount: 0,
  candidateResult: null as null | {
    candidates: typeof parentBlockCandidate[];
    skipped: { missingPullRequest: number; unresolvedRepository: number; alreadyBatched: number };
  },
  recoverableBatches: [] as Array<typeof testIntegrationBatch & { items: Array<Record<string, unknown>> }>,
  openReleaseBatch: null as null | Record<string, unknown>,
  batchByIdWithItems: new Map<
    string,
    Record<string, unknown> & { items: Array<Record<string, unknown>> }
  >(),
};

const parentBlockCandidate = {
  id: "feature-1",
  taskId: "O-F-1",
  title: "Back office: acceso y arquitectura base",
  boardId: "board-1",
  projectId: testProject.id,
  repositoryId: testRepository.id,
  repositoryFullName: "example-org/example-repo",
  baseBranch: "main",
  prNumber: 10,
  prUrl: "https://github.com/example-org/example-repo/pull/10",
  branchName: "almirant/O-F-1",
  updatedAt: new Date("2026-05-03T10:00:00.000Z"),
};

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    validateApiKey: async () => ({
      id: "worker-api-key",
      workspaceId: testWorkspace.id,
    }),
    getValidatingReleaseCandidates: async () => ({
      candidates: state.candidateResult?.candidates ?? [parentBlockCandidate],
      skipped: state.candidateResult?.skipped ?? {
        missingPullRequest: 0,
        unresolvedRepository: 0,
        alreadyBatched: 0,
      },
    }),
    countActiveBatchItemsByProject: async () => state.activeBatchItemCount,
    getRecoverableReleaseBatchesWithoutActiveJob: async () => state.recoverableBatches,
    getGithubRepoFullNameByRepoId: async () => "example-org/example-repo",
    getOpenReleaseBatchForRepository: async () => state.openReleaseBatch,
    getActiveBatchForRepository: async () => null,
    getBatchByIdWithItems: async (id: string) => state.batchByIdWithItems.get(id) ?? null,
    getNextReleaseNumber: async () => 7,
    createIntegrationBatch: async (input: Record<string, unknown>) => {
      state.createdBatches.push(input);
      return {
        ...testIntegrationBatch,
        id: "batch-release-7",
        ...input,
      };
    },
    addItemsToBatch: async (items: Record<string, unknown>[]) => {
      state.addedItems.push(...items);
      return [];
    },
    updateBatchStatus: async (id: string, status: string) => {
      state.updatedBatchStatuses.push({ id, status });
      const batch = state.batchByIdWithItems.get(id) ?? state.openReleaseBatch;
      return batch ? { ...batch, status } : null;
    },
    createJob: async (input: Record<string, unknown>) => {
      state.createdJobs.push(input);
      return { id: "job-1", status: "queued", ...input };
    },
  } as Record<string, unknown>)
);

mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../integrations/github/services/github-service", () =>
  createGithubServiceMock({
    getInstallationAccessToken: async () => "gh-token",
    fetchFromGithub: async () => ({}),
  }),
);
mock.module("../../ai/shared/services/resolve-ai-key", () => ({
  resolveAiKey: async () => null,
  refreshConnectionCredentialsIfNeeded: async (
    _connection: Record<string, unknown>,
    _encryptionKey: string,
    credentials?: Record<string, unknown>,
  ) => credentials ?? { apiKey: "refreshed-fallback-key" },
}));

const makeRequest = (): Request =>
  new Request(
    `http://localhost/workers/release-integration/queue?projectId=${testProject.id}`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer worker-secret",
      },
    },
  );

describe("workersRoutes POST /workers/release-integration/queue", () => {
  beforeEach(() => {
    state.createdBatches = [];
    state.addedItems = [];
    state.createdJobs = [];
    state.updatedBatchStatuses = [];
    state.activeBatchItemCount = 0;
    state.candidateResult = null;
    state.recoverableBatches = [];
    state.openReleaseBatch = null;
    state.batchByIdWithItems = new Map();
  });

  it("creates a numbered release batch from parent block PR candidates", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest());
    const body = (await res.json()) as {
      success: boolean;
      data: {
        batches: Array<{ batchId: string; enqueuedItemCount: number }>;
        skipped: Record<string, number>;
      };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(state.createdBatches).toHaveLength(1);
    expect(state.createdBatches[0]).toMatchObject({
      integrationBranch: "release/main-v7",
      releaseNumber: 7,
      repositoryId: testRepository.id,
      projectId: testProject.id,
    });
    expect(state.addedItems).toHaveLength(1);
    expect(state.addedItems[0]).toMatchObject({
      workItemId: "feature-1",
      prNumber: 10,
      branchName: "almirant/O-F-1",
    });
    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]).toMatchObject({
      jobType: "integration",
      skillName: "runner-release-integration",
      promptTemplate: "runner-release-integration",
      triggerType: "scheduled",
      config: {
        skillName: "runner-release-integration",
        batchId: "batch-release-7",
        integrationPhase: "process",
        executionName: "Integration — example-org/example-repo",
        repositoryFullName: "example-org/example-repo",
        selfManagesPr: true,
      },
    });
    expect(body.data.batches[0]?.enqueuedItemCount).toBe(1);
    expect(body.data.skipped.missingPullRequest).toBe(0);
  });

  it("does not enqueue release integration when the project has no Validating candidates", async () => {
    state.candidateResult = {
      candidates: [],
      skipped: { missingPullRequest: 0, unresolvedRepository: 0, alreadyBatched: 0 },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest());
    const body = (await res.json()) as {
      success: boolean;
      data: {
        batches: Array<{ batchId: string }>;
        skipped: Record<string, number>;
      };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(state.createdBatches).toHaveLength(0);
    expect(state.addedItems).toHaveLength(0);
    expect(state.createdJobs).toHaveLength(0);
    expect(body.data.batches).toEqual([]);
    expect(body.data.skipped.noCandidates).toBe(1);
  });

  it("re-enqueues orphaned queued release batches before enforcing project active limits", async () => {
    state.activeBatchItemCount = 3;
    state.candidateResult = {
      candidates: [],
      skipped: { missingPullRequest: 0, unresolvedRepository: 0, alreadyBatched: 0 },
    };
    state.recoverableBatches = [
      {
        ...testIntegrationBatch,
        id: "batch-orphan",
        projectId: testProject.id,
        repositoryId: testRepository.id,
        boardId: "board-1",
        baseBranch: "main",
        status: "queued",
        items: [
          { id: "item-1", status: "pending" },
          { id: "item-2", status: "pending" },
          { id: "item-3", status: "pending" },
        ],
      },
    ];

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      new Request(
        `http://localhost/workers/release-integration/queue?projectId=${testProject.id}&maxActiveItems=1&limit=1`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer worker-secret",
          },
        },
      ),
    );
    const body = (await res.json()) as {
      success: boolean;
      data: {
        batches: Array<{
          batchId: string;
          repositoryId: string;
          projectId: string;
          created: boolean;
          enqueuedItemCount: number;
        }>;
        skipped: Record<string, number>;
      };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(state.createdBatches).toHaveLength(0);
    expect(state.addedItems).toHaveLength(0);
    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]).toMatchObject({
      jobType: "integration",
      skillName: "runner-release-integration",
      promptTemplate: "runner-release-integration",
      triggerType: "scheduled",
      config: {
        skillName: "runner-release-integration",
        batchId: "batch-orphan",
        integrationPhase: "process",
        executionName: "Integration — example-org/example-repo",
        repositoryFullName: "example-org/example-repo",
        selfManagesPr: true,
      },
    });
    expect(body.data.batches).toEqual([
      {
        batchId: "batch-orphan",
        repositoryId: testRepository.id,
        projectId: testProject.id,
        created: false,
        enqueuedItemCount: 3,
      },
    ]);
    expect(body.data.skipped.activeProjectLimit).toBe(0);
  });

  it("appends candidates to an awaiting release batch and re-enqueues it when capacity is available", async () => {
    const awaitingBatch = {
      ...testIntegrationBatch,
      id: "batch-awaiting-release",
      projectId: testProject.id,
      repositoryId: testRepository.id,
      boardId: "board-1",
      baseBranch: "main",
      integrationBranch: "release/main-v7",
      releaseNumber: 7,
      status: "awaiting_release",
      items: [
        { id: "item-existing", workItemId: "feature-existing", status: "merged" },
      ],
    };
    state.openReleaseBatch = awaitingBatch;
    state.batchByIdWithItems.set(awaitingBatch.id, awaitingBatch);
    state.activeBatchItemCount = 0;
    state.candidateResult = {
      candidates: [parentBlockCandidate],
      skipped: { missingPullRequest: 0, unresolvedRepository: 0, alreadyBatched: 0 },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      new Request(
        `http://localhost/workers/release-integration/queue?projectId=${testProject.id}&maxActiveItems=1&limit=1`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer worker-secret",
          },
        },
      ),
    );
    const body = (await res.json()) as {
      success: boolean;
      data: {
        batches: Array<{
          batchId: string;
          repositoryId: string;
          projectId: string;
          created: boolean;
          enqueuedItemCount: number;
        }>;
        skipped: Record<string, number>;
      };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(state.createdBatches).toHaveLength(0);
    expect(state.updatedBatchStatuses).toEqual([
      { id: "batch-awaiting-release", status: "queued" },
    ]);
    expect(state.addedItems).toHaveLength(1);
    expect(state.addedItems[0]).toMatchObject({
      batchId: "batch-awaiting-release",
      workItemId: "feature-1",
      prNumber: 10,
      branchName: "almirant/O-F-1",
      processingOrder: 1,
    });
    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]).toMatchObject({
      jobType: "integration",
      skillName: "runner-release-integration",
      promptTemplate: "runner-release-integration",
      triggerType: "scheduled",
      config: {
        skillName: "runner-release-integration",
        batchId: "batch-awaiting-release",
        integrationPhase: "process",
        executionName: "Integration — example-org/example-repo",
        repositoryFullName: "example-org/example-repo",
        selfManagesPr: true,
      },
    });
    expect(body.data.batches).toEqual([
      {
        batchId: "batch-awaiting-release",
        repositoryId: testRepository.id,
        projectId: testProject.id,
        created: false,
        enqueuedItemCount: 1,
      },
    ]);
    expect(body.data.skipped.activeProjectLimit).toBe(0);
  });

  it("does not treat repository-filtered duplicate candidates as available release capacity", async () => {
    const awaitingBatch = {
      ...testIntegrationBatch,
      id: "batch-awaiting-release",
      projectId: testProject.id,
      repositoryId: testRepository.id,
      boardId: "board-1",
      baseBranch: "main",
      integrationBranch: "release/main-v7",
      releaseNumber: 7,
      status: "awaiting_release",
      items: [
        { id: "item-existing", workItemId: "feature-existing", status: "failed" },
      ],
    };
    state.openReleaseBatch = awaitingBatch;
    state.batchByIdWithItems.set(awaitingBatch.id, awaitingBatch);
    state.activeBatchItemCount = 0;
    state.candidateResult = {
      candidates: [parentBlockCandidate],
      skipped: { missingPullRequest: 0, unresolvedRepository: 0, alreadyBatched: 1 },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      new Request(
        `http://localhost/workers/release-integration/queue?projectId=${testProject.id}&maxActiveItems=1&limit=1`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer worker-secret",
          },
        },
      ),
    );
    const body = (await res.json()) as {
      success: boolean;
      data: {
        batches: Array<{
          batchId: string;
          enqueuedItemCount: number;
        }>;
        skipped: Record<string, number>;
      };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(state.addedItems).toHaveLength(1);
    expect(state.addedItems[0]).toMatchObject({
      batchId: "batch-awaiting-release",
      workItemId: "feature-1",
      processingOrder: 1,
    });
    expect(state.createdJobs).toHaveLength(1);
    expect(body.data.batches[0]?.enqueuedItemCount).toBe(1);
    expect(body.data.skipped.duplicateItems).toBe(1);
  });

  it("does not retry a failed item: treats the candidate matching it as a duplicate and creates no new job", async () => {
    const awaitingBatch = {
      ...testIntegrationBatch,
      id: "batch-awaiting-release",
      projectId: testProject.id,
      repositoryId: testRepository.id,
      boardId: "board-1",
      baseBranch: "main",
      integrationBranch: "release/main-v7",
      releaseNumber: 7,
      status: "awaiting_release",
      items: [
        {
          id: "item-failed",
          workItemId: "feature-1",
          status: "failed",
          prNumber: 10,
          prUrl: "https://github.com/example-org/example-repo/pull/10",
          branchName: "almirant/O-F-1",
        },
      ],
    };
    state.openReleaseBatch = awaitingBatch;
    state.batchByIdWithItems.set(awaitingBatch.id, awaitingBatch);
    state.activeBatchItemCount = 0;
    state.candidateResult = {
      candidates: [parentBlockCandidate],
      skipped: { missingPullRequest: 0, unresolvedRepository: 0, alreadyBatched: 0 },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      new Request(
        `http://localhost/workers/release-integration/queue?projectId=${testProject.id}&maxActiveItems=1&limit=1`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer worker-secret",
          },
        },
      ),
    );
    const body = (await res.json()) as {
      success: boolean;
      data: {
        batches: Array<{ batchId: string; enqueuedItemCount: number }>;
        skipped: Record<string, number>;
      };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(state.addedItems).toHaveLength(0);
    expect(state.createdJobs).toHaveLength(0);
    expect(state.updatedBatchStatuses).toEqual([]);
    expect(body.data.batches).toEqual([]);
    expect(body.data.skipped.duplicateItems).toBe(1);
  });

  it("appends a fresh candidate alongside an existing failed item without retrying the failed one", async () => {
    const awaitingBatch = {
      ...testIntegrationBatch,
      id: "batch-awaiting-release",
      projectId: testProject.id,
      repositoryId: testRepository.id,
      boardId: "board-1",
      baseBranch: "main",
      integrationBranch: "release/main-v7",
      releaseNumber: 7,
      status: "awaiting_release",
      items: [
        {
          id: "item-failed",
          workItemId: "feature-already-failed",
          status: "failed",
          prNumber: 9,
          prUrl: "https://github.com/example-org/example-repo/pull/9",
          branchName: "almirant/O-F-prev",
        },
      ],
    };
    state.openReleaseBatch = awaitingBatch;
    state.batchByIdWithItems.set(awaitingBatch.id, awaitingBatch);
    state.activeBatchItemCount = 0;
    state.candidateResult = {
      candidates: [parentBlockCandidate],
      skipped: { missingPullRequest: 0, unresolvedRepository: 0, alreadyBatched: 0 },
    };

    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest());
    expect(res.status).toBe(200);

    expect(state.addedItems).toHaveLength(1);
    expect(state.addedItems[0]).toMatchObject({
      batchId: "batch-awaiting-release",
      workItemId: "feature-1",
      processingOrder: 1,
    });
    expect(state.createdJobs).toHaveLength(1);
    expect(state.updatedBatchStatuses).toEqual([
      { id: "batch-awaiting-release", status: "queued" },
    ]);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("../../ai/shared/services/resolve-ai-key", () => __real_resolveAiKey);
});
