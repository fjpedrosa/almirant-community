import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
} from "../../../../test/mocks";
import {
  testIntegrationBatch,
  testIntegrationBatchItem,
} from "../../../../test/fixtures";

const state = {
  batchOverride: null as null | Record<string, unknown>,
  releasePullRequestRefs: [] as Array<{
    batchId: string;
    ref: Record<string, unknown>;
  }>,
  releaseColumnMoves: [] as Array<{ batchId: string }>,
  aiProcessingCalls: [] as Array<{
    organizationId: string;
    workItemId: string;
    isAiProcessing: boolean;
  }>,
  broadcasts: [] as Array<{
    organizationId: string;
    message: Record<string, unknown>;
  }>,
};

const makeRequest = (path: string, options?: RequestInit): Request =>
  new Request(`http://localhost${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: "Bearer valid-runner-key",
      ...(options?.headers ?? {}),
    },
  });

const jsonBody = (data: unknown, method: string = "POST"): RequestInit => ({
  method,
  body: JSON.stringify(data),
});

const parseResponse = async <T = unknown>(
  res: Response,
): Promise<{ status: number; body: T }> => {
  const body = (await res.json()) as T;
  return { status: res.status, body };
};

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    validateApiKey: async (raw: string) =>
      raw === "valid-runner-key"
        ? { id: "key-1", organizationId: "org-test-1" }
        : null,
    getBatchByIdWithItems: async (id: string) =>
      state.batchOverride ??
      (id === testIntegrationBatch.id
        ? { ...testIntegrationBatch, items: [testIntegrationBatchItem] }
        : null),
    setReleasePullRequestForBatch: async (
      batchId: string,
      ref: Record<string, unknown>,
    ) => {
      state.releasePullRequestRefs.push({ batchId, ref });
      return 1;
    },
    moveMergedIntegrationBatchItemsToReleaseColumn: async (batchId: string) => {
      state.releaseColumnMoves.push({ batchId });
      return {
        moved: 1,
        alreadyInRelease: 0,
        skippedMissingReleaseColumn: 0,
        missingReleaseColumnBoardIds: [],
        failed: [],
      };
    },
    setWorkItemAiProcessing: async (
      organizationId: string,
      workItemId: string,
      isAiProcessing: boolean,
    ) => {
      state.aiProcessingCalls.push({
        organizationId,
        workItemId,
        isAiProcessing,
      });
      return true;
    },
    loadDescendantLeafColumnsByParent: async (parentIds: string[]) => {
      const result = new Map<string, Array<unknown>>();
      for (const id of parentIds) result.set(id, []);
      return result;
    },
  } as Record<string, unknown>),
);
mock.module("../../../../shared/services/response", () => createResponseMocks());
mock.module("../../../../shared/ws/ws-connection-manager", () => ({
  wsConnectionManager: {
    broadcastToOrganization: (
      organizationId: string,
      message: Record<string, unknown>,
    ) => {
      state.broadcasts.push({ organizationId, message });
    },
    sendToUser: () => {},
  },
}));

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { internalIntegrationBatchesRoutes } = await import(
    "./internal-integration-batches.routes"
  );
  return new Elysia().use(internalIntegrationBatchesRoutes);
};

beforeEach(() => {
  state.batchOverride = null;
  state.releasePullRequestRefs = [];
  state.releaseColumnMoves = [];
  state.aiProcessingCalls = [];
  state.broadcasts = [];
});

// =======================================================
// Auth
// =======================================================
describe("internal-integration-batches.routes - auth", () => {
  it("returns 401 without Bearer token", async () => {
    const app = await makeApp();
    const res = await app.handle(
      new Request(
        `http://localhost/internal/integration-batches/${testIntegrationBatch.id}`,
      ),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const app = await makeApp();
    const res = await app.handle(
      new Request(
        `http://localhost/internal/integration-batches/${testIntegrationBatch.id}`,
        { headers: { authorization: "Bearer wrong" } },
      ),
    );
    expect(res.status).toBe(401);
  });
});

// =======================================================
// GET /internal/integration-batches/:id
// =======================================================
describe("internal-integration-batches.routes - GET /:id", () => {
  it("returns the batch with items", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(`/internal/integration-batches/${testIntegrationBatch.id}`),
    );
    const { status, body } = await parseResponse<{
      success: boolean;
      data: { id: string; items: unknown[] };
    }>(res);
    expect(status).toBe(200);
    expect(body.data.id).toBe(testIntegrationBatch.id);
    expect(Array.isArray(body.data.items)).toBe(true);
  });

  it("returns 404 when not found", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(`/internal/integration-batches/non-existent`),
    );
    expect(res.status).toBe(404);
  });
});

// =======================================================
// PATCH /internal/integration-batches/:id
// =======================================================
describe("internal-integration-batches.routes - PATCH /:id", () => {
  it("updates batch status", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        `/internal/integration-batches/${testIntegrationBatch.id}`,
        jsonBody({ status: "running" }, "PATCH"),
      ),
    );
    const { status, body } = await parseResponse<{ success: boolean; data: unknown }>(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("clears all linked blocks when the batch leaves item processing", async () => {
    state.batchOverride = {
      ...testIntegrationBatch,
      items: [
        testIntegrationBatchItem,
        {
          ...testIntegrationBatchItem,
          id: "batch-item-test-2",
          workItemId: "wi-test-2",
          processingOrder: 1,
        },
      ],
    };

    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        `/internal/integration-batches/${testIntegrationBatch.id}`,
        jsonBody({ status: "awaiting_release" }, "PATCH"),
      ),
    );

    expect(res.status).toBe(200);
    expect(state.aiProcessingCalls).toEqual([
      {
        organizationId: testIntegrationBatch.organizationId,
        workItemId: testIntegrationBatchItem.workItemId,
        isAiProcessing: false,
      },
      {
        organizationId: testIntegrationBatch.organizationId,
        workItemId: "wi-test-2",
        isAiProcessing: false,
      },
    ]);
  });

  it("updates currentItemIndex", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        `/internal/integration-batches/${testIntegrationBatch.id}`,
        jsonBody({ currentItemIndex: 3 }, "PATCH"),
      ),
    );
    expect(res.status).toBe(200);
  });

  it("returns 422 with empty body (nothing to update)", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        `/internal/integration-batches/${testIntegrationBatch.id}`,
        jsonBody({}, "PATCH"),
      ),
    );
    expect(res.status).toBe(400);
  });
});

// =======================================================
// PATCH /internal/integration-batches/:id/items/:itemId
// =======================================================
describe("internal-integration-batches.routes - PATCH /:id/items/:itemId", () => {
  it("updates item status", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        `/internal/integration-batches/${testIntegrationBatch.id}/items/${testIntegrationBatchItem.id}`,
        jsonBody({ status: "rebasing" }, "PATCH"),
      ),
    );
    expect(res.status).toBe(200);
    expect(state.aiProcessingCalls).toEqual([
      {
        organizationId: testIntegrationBatch.organizationId,
        workItemId: testIntegrationBatchItem.workItemId,
        isAiProcessing: true,
      },
    ]);
    expect(state.broadcasts[0]!.message).toEqual({
      type: "work-item:updated",
      payload: {
        workItemId: testIntegrationBatchItem.workItemId,
        changes: { isAiProcessing: true },
      },
    });
  });

  it("clears the linked block for terminal item statuses", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        `/internal/integration-batches/${testIntegrationBatch.id}/items/${testIntegrationBatchItem.id}`,
        jsonBody({ status: "merged" }, "PATCH"),
      ),
    );

    expect(res.status).toBe(200);
    expect(state.aiProcessingCalls).toEqual([
      {
        organizationId: testIntegrationBatch.organizationId,
        workItemId: testIntegrationBatchItem.workItemId,
        isAiProcessing: false,
      },
    ]);
  });

  it("records a failure", async () => {
    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        `/internal/integration-batches/${testIntegrationBatch.id}/items/${testIntegrationBatchItem.id}`,
        jsonBody(
          {
            status: "failed",
            failureCategory: "schema_semantic",
            failureReason: "schema rename collision",
          },
          "PATCH",
        ),
      ),
    );
    expect(res.status).toBe(200);
    expect(state.aiProcessingCalls).toEqual([
      {
        organizationId: testIntegrationBatch.organizationId,
        workItemId: testIntegrationBatchItem.workItemId,
        isAiProcessing: false,
      },
    ]);
  });
});

// =======================================================
// POST /internal/integration-batches/:id/release-pr
// =======================================================
describe("internal-integration-batches.routes - POST /:id/release-pr", () => {
  it("re-seeds release metadata and moves merged batch items to To Release when the release PR already exists", async () => {
    state.batchOverride = {
      ...testIntegrationBatch,
      id: "batch-release-existing",
      integrationBranch: "release/main-v7",
      releaseNumber: 7,
      finalPrUrl: "https://github.com/acme/app/pull/77",
      finalPrNumber: 77,
      items: [
        {
          ...testIntegrationBatchItem,
          status: "merged",
          workItemId: "wi-release-1",
        },
      ],
    };

    const app = await makeApp();
    const res = await app.handle(
      makeRequest("/internal/integration-batches/batch-release-existing/release-pr", {
        method: "POST",
      }),
    );
    const { status, body } = await parseResponse<{
      success: boolean;
      data: { prUrl: string; prNumber: number; alreadyExists: boolean };
    }>(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      prUrl: "https://github.com/acme/app/pull/77",
      prNumber: 77,
      alreadyExists: true,
    });
    expect(state.releasePullRequestRefs).toEqual([
      {
        batchId: "batch-release-existing",
        ref: {
          url: "https://github.com/acme/app/pull/77",
          number: 77,
          state: "open",
          branch: "release/main-v7",
          releaseNumber: 7,
        },
      },
    ]);
    expect(state.releaseColumnMoves).toEqual([
      { batchId: "batch-release-existing" },
    ]);
  });
});

// =======================================================
// POST /internal/integration-batches/:id/release-pr/merge
// =======================================================
describe("internal-integration-batches.routes - POST /:id/release-pr/merge", () => {
  it("rejects release PR merge unless the batch is in explicit merging phase", async () => {
    state.batchOverride = {
      ...testIntegrationBatch,
      status: "running",
      finalPrNumber: 77,
      finalPrUrl: "https://github.com/acme/app/pull/77",
      items: [testIntegrationBatchItem],
    };

    const app = await makeApp();
    const res = await app.handle(
      makeRequest(
        `/internal/integration-batches/${testIntegrationBatch.id}/release-pr/merge`,
        jsonBody({ mergeMethod: "squash" }),
      ),
    );
    const { status, body } = await parseResponse<{
      success: boolean;
      error: string;
    }>(res);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain("explicit merge phase");
  });
});
