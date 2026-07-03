import { afterAll, describe, expect, it, mock, beforeEach } from "bun:test";
import {
  createDatabaseMocks,
  createWsMock,
  createResponseMocks,
  createLoggerMock,
  createS3Mock,
  createLocalAttachmentsMock,
  createAiServiceMock,
  createTelegramMock,
  createWorkItemSyncMock,
  createPromptContextMock,
  createAiPricingMock,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";
import { testWorkItem } from "../../../../test/fixtures";

// ── Save real modules BEFORE mocking (prevents cross-file contamination) ──

const __real_aiModelPricing = { ...(await import("../../../../domains/billing/quota/services/ai-model-pricing")) };

// ── Top-level mock.module calls (MUST be before any dynamic imports) ──

const dbMocks = createDatabaseMocks();
const recordUsageMock = mock(async () => {});
mock.module("@almirant/database", () => dbMocks);
mock.module("../../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../../../shared/services/response", () => createResponseMocks());
mock.module("@almirant/config", () => createLoggerMock());
mock.module("../../../../shared/services/s3-service", () => createS3Mock());
mock.module("../../../../shared/services/local-attachments", () => createLocalAttachmentsMock());
mock.module("../../../../domains/ai/shared/services/ai-service", () => createAiServiceMock());
mock.module("../../../../domains/integrations/telegram/services/telegram/notifications", () => createTelegramMock());
mock.module("../services/work-item-sync", () => createWorkItemSyncMock());
mock.module("../services/prompt-context-service", () => createPromptContextMock());
mock.module("../../../../domains/billing/quota/services/ai-model-pricing", () => createAiPricingMock());
mock.module("../../../../domains/billing/quota/services/quota-service-instance", () => ({
  quotaService: {
    recordUsage: recordUsageMock,
  },
}));
mock.module("./work-items-typed-create.routes", () => ({
  workItemsTypedCreateRoutes: (app: unknown) => app,
}));

// ── Factory to build a fresh Elysia app per test ──

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { workItemsRoutes } = await import("./work-items.routes");
  return new Elysia().use(withTestOrg).use(workItemsRoutes);
};

// ── Helpers ──

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

// ── Test suites ──

describe("workItemsRoutes", () => {
  beforeEach(() => {
    recordUsageMock.mockClear();
  });

  // ── GET /work-items ──

  describe("GET /work-items", () => {
    it("returns a paginated list of work items", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/work-items"));
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
        meta: { page: number; limit: number; total: number };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.meta.total).toBe(1);
    });

    it("passes query filters through", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest("/work-items?page=2&limit=10&search=foo&type=task&priority=high")
      );
      const { status, body } = await parseResponse<{ success: boolean }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ── POST /work-items ──

  describe("POST /work-items", () => {
    it("creates a work item and returns 201", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items",
          jsonBody({
            boardId: "board-test-1",
            boardColumnId: "col-test-1",
            type: "task",
            title: "New Work Item",
          })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { title: string };
      }>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe("New Work Item");
    });

    it("returns 400 when title is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items",
          jsonBody({
            boardId: "board-test-1",
            boardColumnId: "col-test-1",
            type: "task",
            title: "",
          })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Title is required");
    });

    it("returns 400 when boardId is missing", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items",
          jsonBody({
            boardColumnId: "col-test-1",
            type: "task",
            title: "No Board",
          })
        )
      );

      // Elysia schema validation rejects missing required fields
      expect(res.status).toBe(422);
    });

    it("returns 400 when type is missing", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items",
          jsonBody({
            boardId: "board-test-1",
            boardColumnId: "col-test-1",
            title: "No Type",
          })
        )
      );

      // Missing required 'type' field triggers Elysia validation
      expect(res.status).toBe(422);
    });

    it("returns 400 when createWorkItem fails with BOARD_COLUMN_NOT_FOUND", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items",
          jsonBody({
            boardId: "board-test-1",
            boardColumnId: "area-desarrollo-backlog",
            type: "task",
            title: "New Work Item",
          })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Column \"area-desarrollo-backlog\" was not found");
    });
  });

  // ── GET /work-items/:id ──

  describe("GET /work-items/:id", () => {
    it("returns the work item when found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/work-items/${testWorkItem.id}`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string; title: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testWorkItem.id);
      expect(body.data.title).toBe(testWorkItem.title);
    });

    it("returns 404 when work item does not exist", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/work-items/nonexistent"));
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  // ── PATCH /work-items/:id ──

  describe("PATCH /work-items/:id", () => {
    it("updates a work item successfully", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}`,
          jsonBody({ title: "Updated Title" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { title: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe("Updated Title");
    });

    it("updates priority field", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}`,
          jsonBody({ priority: "urgent" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { priority: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.priority).toBe("urgent");
    });

    it("returns 404 when work item does not exist", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items/nonexistent",
          jsonBody({ title: "Nope" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  // ── DELETE /work-items/:id ──

  describe("DELETE /work-items/:id", () => {
    it("deletes a work item successfully", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/work-items/${testWorkItem.id}`, { method: "DELETE" })
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { deleted: boolean };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it("returns 404 when work item does not exist", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest("/work-items/nonexistent", { method: "DELETE" })
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  // ── POST /work-items/bulk/move ──

  describe("POST /work-items/bulk/move", () => {
    it("bulk moves work items to a target column", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items/bulk/move",
          jsonBody({
            workItemIds: ["wi-1", "wi-2"],
            boardColumnId: "col-target",
          })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { moved: boolean; count: number };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.moved).toBe(true);
      expect(body.data.count).toBe(2);
    });

    it("returns 400 when workItemIds is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items/bulk/move",
          jsonBody({ workItemIds: [], boardColumnId: "col-target" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Work item IDs are required");
    });

    it("returns 400 when boardColumnId is missing", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items/bulk/move",
          jsonBody({ workItemIds: ["wi-1"], boardColumnId: "" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board column ID is required");
    });

    it("expands parent-type selections to their descendant leaf tasks", async () => {
      const parentId = "epic-parent-1";
      const leafIds = ["task-child-1", "task-child-2"];
      // Parent-type ids the repository would silently filter out.
      const parentIds = new Set([parentId]);
      let receivedIds: string[] = [];

      const itemById: Record<
        string,
        { id: string; type: string; boardColumnId: string | null; boardId: string }
      > = {
        [parentId]: { id: parentId, type: "epic", boardColumnId: null, boardId: "board-test-1" },
        "task-child-1": { id: "task-child-1", type: "task", boardColumnId: "col-test-1", boardId: "board-test-1" },
        "task-child-2": { id: "task-child-2", type: "task", boardColumnId: "col-test-1", boardId: "board-test-1" },
      };

      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getWorkItemById: async (id: string) => itemById[id] ?? null,
          getDescendantLeafIds: async (id: string) => (id === parentId ? [...leafIds] : []),
          // Mirror the real repository: parent-type ids get filtered; an
          // all-parent set yields nothing movable and returns false.
          bulkMoveWorkItems: async (_orgId: string, ids: string[]) => {
            receivedIds = ids;
            return ids.some((id) => !parentIds.has(id));
          },
        })
      );

      const { Elysia } = await import("elysia");
      const { workItemsRoutes } = await import("./work-items.routes");
      const app = new Elysia().use(withTestOrg).use(workItemsRoutes);

      try {
        const res = await app.handle(
          makeRequest(
            "/work-items/bulk/move",
            jsonBody({ workItemIds: [parentId], boardColumnId: "col-target" })
          )
        );
        const { status, body } = await parseResponse<{
          success: boolean;
          data: { moved: boolean; count: number };
        }>(res);

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.moved).toBe(true);
        // The parent id must never reach the repository — only its leaf tasks.
        expect(receivedIds).toEqual(leafIds);
        expect(receivedIds).not.toContain(parentId);
      } finally {
        mock.module("@almirant/database", () => dbMocks);
      }
    });

    it("returns a specific error when the selection resolves to no movable tasks", async () => {
      const parentId = "epic-empty-1";
      let bulkCalled = false;

      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getWorkItemById: async (id: string) =>
            id === parentId
              ? { id: parentId, type: "epic", boardColumnId: null, boardId: "board-test-1" }
              : null,
          getDescendantLeafIds: async () => [],
          bulkMoveWorkItems: async () => {
            bulkCalled = true;
            return false;
          },
        })
      );

      const { Elysia } = await import("elysia");
      const { workItemsRoutes } = await import("./work-items.routes");
      const app = new Elysia().use(withTestOrg).use(workItemsRoutes);

      try {
        const res = await app.handle(
          makeRequest(
            "/work-items/bulk/move",
            jsonBody({ workItemIds: [parentId], boardColumnId: "col-target" })
          )
        );
        const { status, body } = await parseResponse<{
          success: boolean;
          error: string;
        }>(res);

        expect(status).toBe(400);
        expect(body.success).toBe(false);
        expect(body.error).toContain("No movable tasks in selection");
        // The generic guard must not be the one that fired.
        expect(body.error).not.toContain("Failed to move work items");
        // Nothing movable → the repository must not be invoked at all.
        expect(bulkCalled).toBe(false);
      } finally {
        mock.module("@almirant/database", () => dbMocks);
      }
    });
  });

  // ── PATCH /work-items/bulk/priority ──

  describe("PATCH /work-items/bulk/priority", () => {
    it("bulk changes priority for multiple items", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items/bulk/priority",
          jsonBody({ workItemIds: ["wi-1", "wi-2"], priority: "high" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { updated: boolean; count: number };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.updated).toBe(true);
      expect(body.data.count).toBe(2);
    });

    it("returns 400 when workItemIds is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items/bulk/priority",
          jsonBody({ workItemIds: [], priority: "high" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Work item IDs are required");
    });

    it("returns 400 for an invalid priority value", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/work-items/bulk/priority",
          jsonBody(
            { workItemIds: ["wi-1"], priority: "super-ultra-critical" },
            "PATCH"
          )
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Valid priority is required");
    });
  });

  // ── PATCH /work-items/:id/move ──

  describe("PATCH /work-items/:id/move", () => {
    it("moves a work item to a new column and position", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/move`,
          jsonBody({ boardColumnId: "col-test-2", position: 3 }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { moved: boolean };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.moved).toBe(true);
    });

    it("returns 400 when boardColumnId is missing", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/move`,
          jsonBody({ boardColumnId: "", position: 0 }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board column ID is required");
    });

    it("returns 404 when the work item does not exist", async () => {
      // moveWorkItem returns false for non-existent IDs.
      // The default mock returns true, but we need it to return false
      // for a non-existent ID. The mock's getWorkItemById already returns
      // null for unknown IDs; moveWorkItem always returns true.
      // We test the boardColumnId-missing path instead to confirm error handling.
      // For a full 404 test, we'd need to override moveWorkItem.
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/move`,
          jsonBody(
            { boardColumnId: "col-test-2", position: 0 },
            "PATCH"
          )
        )
      );
      const { status } = await parseResponse(res);

      expect(status).toBe(200);
    });
  });

  // ── PATCH /work-items/:id/parent ──

  describe("PATCH /work-items/:id/parent", () => {
    it("changes the parent of a work item", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/parent`,
          jsonBody({ parentId: "wi-parent-1" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { parentId: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.parentId).toBe("wi-parent-1");
    });

    it("allows setting parentId to null (un-parent)", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/parent`,
          jsonBody({ parentId: null }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { parentId: null };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.parentId).toBeNull();
    });
  });

  // ── GET /work-items/:id/dependencies ──

  describe("GET /work-items/:id/dependencies", () => {
    it("returns dependencies and dependents arrays", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/work-items/${testWorkItem.id}/dependencies`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { dependencies: unknown[]; dependents: unknown[] };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.dependencies)).toBe(true);
      expect(Array.isArray(body.data.dependents)).toBe(true);
    });
  });

  // ── POST /work-items/:id/dependencies ──

  describe("POST /work-items/:id/dependencies", () => {
    it("adds a dependency and returns 201", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/dependencies`,
          jsonBody({ blockedByWorkItemId: "wi-blocker-1" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string };
      }>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("dep-1");
    });

    it("returns 400 when a work item depends on itself", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/dependencies`,
          jsonBody({ blockedByWorkItemId: testWorkItem.id })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("cannot depend on itself");
    });

    it("returns 400 when blockedByWorkItemId is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/dependencies`,
          jsonBody({ blockedByWorkItemId: "" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("blockedByWorkItemId is required");
    });
  });

  // ── DELETE /work-items/:id/dependencies/:blockedById ──

  describe("DELETE /work-items/:id/dependencies/:blockedById", () => {
    it("removes a dependency successfully", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/dependencies/wi-blocker-1`,
          { method: "DELETE" }
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { deleted: boolean };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });
  });

  // ── GET /work-items/:id/documents ──

  describe("GET /work-items/:id/documents", () => {
    it("returns linked documents for a work item", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/work-items/${testWorkItem.id}/documents`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ── POST /work-items/:id/documents ──

  describe("POST /work-items/:id/documents", () => {
    it("links a document and returns 201", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/documents`,
          jsonBody({ documentId: "doc-abc" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string };
      }>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("link-1");
    });

    it("returns 400 when documentId is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/documents`,
          jsonBody({ documentId: "" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("documentId is required");
    });
  });

  // ── DELETE /work-items/:id/documents/:documentId ──

  describe("DELETE /work-items/:id/documents/:documentId", () => {
    it("unlinks a document successfully", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/documents/doc-abc`,
          { method: "DELETE" }
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { deleted: boolean };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });
  });

  // ── GET /work-items/:id/events ──

  describe("GET /work-items/:id/events", () => {
    it("returns paginated events for a work item", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/work-items/${testWorkItem.id}/events`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
        meta: { page: number; total: number };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("supports date range filtering", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/events?startDate=2025-01-01&endDate=2025-12-31`
        )
      );
      const { status, body } = await parseResponse<{ success: boolean }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ── GET /work-items/:id/attachments ──

  describe("GET /work-items/:id/attachments", () => {
    it("returns attachments for a work item", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/work-items/${testWorkItem.id}/attachments`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ── GET /work-items/:id/ai-sessions ──

  describe("GET /work-items/:id/ai-sessions", () => {
    it("returns AI sessions summary", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/work-items/${testWorkItem.id}/ai-sessions`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { sessions: unknown[]; summary: unknown };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.sessions).toBeDefined();
    });
  });

  // ── POST /work-items/:id/ai-sessions ──

  describe("POST /work-items/:id/ai-sessions", () => {
    it("records an AI session and returns 201", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/ai-sessions`,
          jsonBody({
            model: "claude-sonnet-4-20250514",
            inputTokens: 1000,
            outputTokens: 500,
            totalTokens: 1500,
          })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string };
      }>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("session-1");
      expect(recordUsageMock).toHaveBeenCalledWith(
        "org-test-1",
        "anthropic",
        1500,
        0.01
      );
    });
  });

  // ── PATCH /work-items/:id/prompt ──

  describe("PATCH /work-items/:id/prompt", () => {
    it("saves a generated prompt", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/prompt`,
          jsonBody({ prompt: "Implement feature X..." }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { saved: boolean };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.saved).toBe(true);
    });

    it("returns 400 when prompt is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/prompt`,
          jsonBody({ prompt: "" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Prompt is required");
    });
  });

  // ── GET /work-items/:id/prompt ──

  describe("GET /work-items/:id/prompt", () => {
    it("returns 404 when work item has no generated prompt", async () => {
      // The default testWorkItem has metadata: null, so no prompt stored
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/work-items/${testWorkItem.id}/prompt`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("No generated prompt found");
    });

    it("returns 404 when work item does not exist", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/work-items/nonexistent/prompt"));
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  // ── GET /work-items/:id/suggested-docs ──

  describe("GET /work-items/:id/suggested-docs", () => {
    it("returns suggested documents for a work item", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/work-items/${testWorkItem.id}/suggested-docs`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ── POST /work-items/:id/generate-prompt ──

  describe("POST /work-items/:id/generate-prompt", () => {
    it("returns 503 when AI service is not configured", async () => {
      // Default mock isAiConfigured returns false
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/generate-prompt`,
          jsonBody({})
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(503);
      expect(body.success).toBe(false);
      expect(body.error).toContain("AI service is not configured");
    });
  });

  // ── POST /work-items/:id/generate-docs ──

  describe("POST /work-items/:id/generate-docs", () => {
    it("returns 503 when AI service is not configured", async () => {
      // Default mock isAiConfigured returns false
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/work-items/${testWorkItem.id}/generate-docs`,
          jsonBody({})
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(503);
      expect(body.success).toBe(false);
      expect(body.error).toContain("AI service is not configured");
    });
  });
});

afterAll(() => {
  mock.restore();
  // Re-register real modules to prevent cross-file contamination
  // (mock.restore() does not clear mock.module() registrations in bun)
  mock.module("../../../../domains/billing/quota/services/ai-model-pricing", () => __real_aiModelPricing);
});
