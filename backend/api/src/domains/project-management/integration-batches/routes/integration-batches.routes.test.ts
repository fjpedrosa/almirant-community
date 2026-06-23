import { describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
  withTestOrg,
} from "../../../../test/mocks";
import {
  testProject,
  testRepository,
  testWorkItem,
  testIntegrationBatch,
} from "../../../../test/fixtures";

const makeRequest = (path: string, options?: RequestInit): Request =>
  new Request(`http://localhost${path}`, options);

const jsonBody = (data: unknown, method: string = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

const parseResponse = async <T = unknown>(
  res: Response
): Promise<{ status: number; body: T }> => {
  const body = (await res.json()) as T;
  return { status: res.status, body };
};

mock.module("@almirant/database", () => createDatabaseMocks());
mock.module("../../../../shared/services/response", () => createResponseMocks());

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { integrationBatchesRoutes } = await import("./integration-batches.routes");
  return new Elysia().use(withTestOrg).use(integrationBatchesRoutes);
};

// =======================================================
// POST /integration-batches
// =======================================================
describe("integration-batches.routes - POST /integration-batches", () => {
  it("creates a batch with given workItemIds and returns 201", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        "/integration-batches",
        jsonBody({
          projectId: testProject.id,
          repositoryId: testRepository.id,
          workItemIds: [testWorkItem.id],
        })
      )
    );
    const { status, body } = await parseResponse<{
      success: boolean;
      data: { id: string; status: string };
    }>(res);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(testIntegrationBatch.id);
    expect(body.data.status).toBe("queued");
  });

  it("assigns processing order from release candidate order, not request body order", async () => {
    const addedItems: Array<Record<string, unknown>> = [];
    const earlierWorkItemId = "work-item-earlier-pr";
    const laterWorkItemId = "work-item-later-pr";

    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        getValidatingReleaseCandidates: async () => ({
          candidates: [
            {
              id: earlierWorkItemId,
              taskId: "ZC-E-1",
              title: "Earlier PR",
              boardId: testWorkItem.boardId,
              projectId: testProject.id,
              repositoryId: testRepository.id,
              repositoryFullName: "acme/almirant",
              baseBranch: "main",
              prNumber: 10,
              prUrl: "https://github.com/acme/almirant/pull/10",
              branchName: "feature/earlier-pr",
              updatedAt: new Date("2026-05-03T10:00:00.000Z"),
            },
            {
              id: laterWorkItemId,
              taskId: "ZC-E-2",
              title: "Later PR",
              boardId: testWorkItem.boardId,
              projectId: testProject.id,
              repositoryId: testRepository.id,
              repositoryFullName: "acme/almirant",
              baseBranch: "main",
              prNumber: 20,
              prUrl: "https://github.com/acme/almirant/pull/20",
              branchName: "feature/later-pr",
              updatedAt: new Date("2026-05-03T09:00:00.000Z"),
            },
          ],
          skipped: { missingPullRequest: 0, unresolvedRepository: 0, alreadyBatched: 0 },
        }),
        addItemsToBatch: async (items: Array<Record<string, unknown>>) => {
          addedItems.push(...items);
          return [];
        },
      } as Record<string, unknown>)
    );
    const { Elysia } = await import("elysia");
    const { integrationBatchesRoutes } = await import(
      "./integration-batches.routes"
    );
    const app = new Elysia().use(withTestOrg).use(integrationBatchesRoutes);

    const res = await app.handle(
      makeRequest(
        "/integration-batches",
        jsonBody({
          projectId: testProject.id,
          repositoryId: testRepository.id,
          workItemIds: [laterWorkItemId, earlierWorkItemId],
        })
      )
    );

    expect(res.status).toBe(201);
    expect(addedItems.map((item) => item.workItemId)).toEqual([
      earlierWorkItemId,
      laterWorkItemId,
    ]);
    expect(addedItems.map((item) => item.processingOrder)).toEqual([0, 1]);

    mock.module("@almirant/database", () => createDatabaseMocks());
  });

  it("enqueues an agent job with jobType=integration and a readable execution name", async () => {
    const calls: Array<{
      jobType: unknown;
      batchId: unknown;
      executionName: unknown;
      repositoryFullName: unknown;
    }> = [];
    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        createJob: async (input: Record<string, unknown>) => {
          const cfg = input.config as Record<string, unknown>;
          calls.push({
            jobType: input.jobType,
            batchId: cfg.batchId,
            executionName: cfg.executionName,
            repositoryFullName: cfg.repositoryFullName,
          });
          return { id: "job-1", jobType: input.jobType, status: "queued" };
        },
      } as Record<string, unknown>)
    );
    const { Elysia } = await import("elysia");
    const { integrationBatchesRoutes } = await import(
      "./integration-batches.routes"
    );
    const app = new Elysia().use(withTestOrg).use(integrationBatchesRoutes);

    await app.handle(
      makeRequest(
        "/integration-batches",
        jsonBody({
          projectId: testProject.id,
          repositoryId: testRepository.id,
          workItemIds: [testWorkItem.id],
        })
      )
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.jobType).toBe("integration");
    expect(calls[0]!.batchId).toBe(testIntegrationBatch.id);
    expect(calls[0]!.executionName).toBe("Integration — example/test-repo");
    expect(calls[0]!.repositoryFullName).toBe("example/test-repo");

    mock.module("@almirant/database", () => createDatabaseMocks());
  });

  it("returns 400 when workItemIds is empty", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        "/integration-batches",
        jsonBody({
          projectId: testProject.id,
          repositoryId: testRepository.id,
          workItemIds: [],
        })
      )
    );
    expect(res.status).toBe(422);
  });

  it("returns 400 when projectId is missing", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        "/integration-batches",
        jsonBody({
          repositoryId: testRepository.id,
          workItemIds: [testWorkItem.id],
        })
      )
    );
    expect(res.status).toBe(422);
  });

  it("appends to the existing release when one is open for the repository", async () => {
    // The new release-PR flow accumulates: if a release for the repo is still
    // open (final PR not merged), new POSTs append items rather than 409.
    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        getOpenReleaseBatchForRepository: async () => testIntegrationBatch,
        listItemsByBatch: async () => [],
      } as Record<string, unknown>)
    );
    const { Elysia } = await import("elysia");
    const { integrationBatchesRoutes } = await import(
      "./integration-batches.routes"
    );
    const app = new Elysia().use(withTestOrg).use(integrationBatchesRoutes);

    const res = await app.handle(
      makeRequest(
        "/integration-batches",
        jsonBody({
          projectId: testProject.id,
          repositoryId: testRepository.id,
          workItemIds: [testWorkItem.id],
        })
      )
    );
    const { status, body } = await parseResponse<{
      success: boolean;
      data: { id: string; appended?: number };
    }>(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(testIntegrationBatch.id);
    expect(body.data.appended).toBe(1);

    mock.module("@almirant/database", () => createDatabaseMocks());
  });
});

// =======================================================
// GET /integration-batches/active
// =======================================================
describe("integration-batches.routes - GET /integration-batches/active", () => {
  it("lists active batches for a project", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(`/integration-batches/active?projectId=${testProject.id}`)
    );
    const { status, body } = await parseResponse<{
      success: boolean;
      data: Array<{ id: string }>;
    }>(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.id).toBe(testIntegrationBatch.id);
  });
});

// =======================================================
// GET /integration-batches/:id
// =======================================================
describe("integration-batches.routes - GET /integration-batches/:id", () => {
  it("returns the batch with its items", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(`/integration-batches/${testIntegrationBatch.id}`)
    );
    const { status, body } = await parseResponse<{
      success: boolean;
      data: { id: string; items: unknown[] };
    }>(res);
    expect(status).toBe(200);
    expect(body.data.id).toBe(testIntegrationBatch.id);
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.items.length).toBeGreaterThan(0);
  });

  it("returns 404 when the batch does not exist", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest("/integration-batches/non-existent")
    );
    expect(res.status).toBe(404);
  });
});

// =======================================================
// POST /integration-batches/:id/approve
// =======================================================
describe("integration-batches.routes - POST /:id/approve", () => {
  it("returns 409 when batch is not awaiting_release", async () => {
    const app = await makeApp();
    // default mock returns batch with status='queued' — not awaiting_release
    const res = await app.handle(
      makeRequest(`/integration-batches/${testIntegrationBatch.id}/approve`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(409);
  });

  it("transitions awaiting_release batch to merging", async () => {
    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        getBatchByIdWithItems: async () => ({
          ...testIntegrationBatch,
          status: "awaiting_release" as const,
          items: [],
        }),
      } as Record<string, unknown>)
    );
    const { Elysia } = await import("elysia");
    const { integrationBatchesRoutes } = await import(
      "./integration-batches.routes"
    );
    const app = new Elysia().use(withTestOrg).use(integrationBatchesRoutes);

    const res = await app.handle(
      makeRequest(`/integration-batches/${testIntegrationBatch.id}/approve`, {
        method: "POST",
      })
    );
    const { status, body } = await parseResponse<{
      success: boolean;
      data: { status: string };
    }>(res);
    expect(status).toBe(200);
    expect(body.data.status).toBe("merging");

    mock.module("@almirant/database", () => createDatabaseMocks());
  });
});

// =======================================================
// POST /integration-batches/:id/reject
// =======================================================
describe("integration-batches.routes - POST /:id/reject", () => {
  it("returns 409 when batch is not awaiting_release", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(`/integration-batches/${testIntegrationBatch.id}/reject`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(409);
  });

  it("aborts an awaiting_release batch", async () => {
    mock.module("@almirant/database", () =>
      createDatabaseMocks({
        getBatchByIdWithItems: async () => ({
          ...testIntegrationBatch,
          status: "awaiting_release" as const,
          items: [],
        }),
        updateBatchStatus: async (
          _id: string,
          status: string,
        ) => ({ ...testIntegrationBatch, status }),
      } as Record<string, unknown>)
    );
    const { Elysia } = await import("elysia");
    const { integrationBatchesRoutes } = await import(
      "./integration-batches.routes"
    );
    const app = new Elysia().use(withTestOrg).use(integrationBatchesRoutes);

    const res = await app.handle(
      makeRequest(`/integration-batches/${testIntegrationBatch.id}/reject`, {
        method: "POST",
      })
    );
    const { status, body } = await parseResponse<{
      success: boolean;
      data: { status: string };
    }>(res);
    expect(status).toBe(200);
    expect(body.data.status).toBe("aborted");

    mock.module("@almirant/database", () => createDatabaseMocks());
  });
});
