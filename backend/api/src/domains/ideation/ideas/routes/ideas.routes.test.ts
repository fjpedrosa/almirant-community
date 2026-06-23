import { afterAll, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";
import { testIdeaItem, testWorkItem, testUser } from "../../../../test/fixtures";

const makeRequest = (path: string, options?: RequestInit): Request =>
  new Request(`http://localhost${path}`, options);

const jsonBody = (data: unknown, method: string = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

const parseResponse = async <T = unknown>(res: Response): Promise<{ status: number; body: T }> => {
  const body = (await res.json()) as T;
  return { status: res.status, body };
};

mock.module("@almirant/database", () => createDatabaseMocks());
mock.module("../shared/services/response", () => createResponseMocks());
mock.module("../shared/ws/ws-connection-manager", () => createWsMock());

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { ideasRoutes } = await import("./ideas.routes");
  return new Elysia().use(withTestOrg).use(ideasRoutes);
};

type SuccessBody<T = unknown> = { success: true; data: T; meta?: unknown };
type ErrorBody = { success: false; error: string };

describe("ideasRoutes", () => {
  describe("GET /ideas/items", () => {
    it("returns paginated ideas list", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest("/ideas/items?page=2&limit=10&type=idea&search=test")
      );
      const { status, body } = await parseResponse<
        SuccessBody<{ id: string }[]> & { meta: { page: number; limit: number; total: number } }
      >(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe(testIdeaItem.id);
      expect(body.meta.page).toBe(2);
      expect(body.meta.limit).toBe(10);
      expect(body.meta.total).toBe(1);
    });
  });

  describe("GET /ideas/items/:id", () => {
    it("returns 404 when idea item does not exist", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/ideas/items/nonexistent"));
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  describe("POST /ideas/items", () => {
    it("creates an idea item and trims title", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/ideas/items",
          jsonBody({
            title: "  Idea from test  ",
            type: "idea",
            status: "active",
            projectId: "proj-test-1",
          })
        )
      );
      const { status, body } = await parseResponse<SuccessBody<{ title: string }>>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe("Idea from test");
    });

    it("returns 400 when title is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/ideas/items",
          jsonBody({
            title: "   ",
            type: "idea",
          })
        )
      );
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Title is required");
    });

    it("returns 400 when project does not belong to active organization", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          createIdeaItem: async () => {
            throw new Error("PROJECT_NOT_IN_ORGANIZATION");
          },
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/ideas/items",
          jsonBody({
            title: "Idea with foreign project",
            type: "idea",
            projectId: "proj-foreign",
          })
        )
      );
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("does not belong to active organization");

      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("PATCH /ideas/items/:id/status", () => {
    it("updates idea item status", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/ideas/items/${testIdeaItem.id}/status`,
          jsonBody({ status: "archived" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<SuccessBody<{ status: string }>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("archived");
    });

    it("returns 400 on invalid status transition", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          setIdeaItemStatus: async () => {
            throw new Error("INVALID_STATUS_FOR_TYPE");
          },
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/ideas/items/${testIdeaItem.id}/status`,
          jsonBody({ status: "rejected" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Invalid status");

      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("POST /ideas/items/:id/promote", () => {
    it("creates work item and traceability link", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/ideas/items/${testIdeaItem.id}/promote`,
          jsonBody({
            workItemType: "task",
            title: "Promoted task",
            boardId: "board-test-1",
            boardColumnId: "col-test-1",
            projectId: "proj-test-1",
          })
        )
      );
      const { status, body } = await parseResponse<
        SuccessBody<{
          workItem: { id: string };
          link: { ideaItemId: string; workItemId: string };
        }>
      >(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.workItem.id).toBe(testWorkItem.id);
      expect(body.data.link.ideaItemId).toBe(testIdeaItem.id);
      expect(body.data.link.workItemId).toBe(testWorkItem.id);
    });
  });

  describe("GET /ideas/items/:id/traceability", () => {
    it("returns 404 when traceability is not found", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/ideas/items/nonexistent/traceability"));
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  describe("GET /ideas/items/:id/history", () => {
    it("returns paginated history events", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/ideas/items/${testIdeaItem.id}/history?page=1&limit=10`)
      );
      const { status, body } = await parseResponse<
        SuccessBody<Array<{ id: string; eventType: string }>> & {
          meta: { page: number; limit: number; total: number };
        }
      >(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.eventType).toBe("created");
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(10);
      expect(body.meta.total).toBe(1);
    });
  });

  describe("GET /ideas/items/:id/comments/:commentId/history", () => {
    it("returns comment version history when comment exists", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getCommentsByIdeaItem: async () => [
            {
              id: "comment-test-1",
              ideaItemId: testIdeaItem.id,
              userId: testUser.id,
              content: "latest",
              createdAt: new Date("2025-01-01"),
              updatedAt: new Date("2025-01-02"),
              author: {
                id: testUser.id,
                name: testUser.name,
                email: testUser.email,
                image: testUser.image,
              },
              mentionedUserIds: [],
            },
          ],
          getIdeaItemCommentVersions: async () => [
            {
              id: "version-test-1",
              commentId: "comment-test-1",
              entityType: "idea",
              content: "previous content",
              editedAt: new Date("2025-01-02"),
              editedByUserId: testUser.id,
              editedBy: {
                id: testUser.id,
                name: testUser.name,
                email: testUser.email,
                image: testUser.image,
              },
            },
          ],
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/ideas/items/${testIdeaItem.id}/comments/comment-test-1/history`)
      );
      const { status, body } = await parseResponse<SuccessBody<Array<{ id: string }>>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe("version-test-1");

      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns 404 when comment does not exist", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getCommentsByIdeaItem: async () => [],
        })
      );

      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/ideas/items/${testIdeaItem.id}/comments/comment-missing/history`)
      );
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");

      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  describe("feedback links endpoints", () => {
    it("creates feedback link", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/ideas/items/${testIdeaItem.id}/feedback-links/feedback-test-1`,
          jsonBody({ metadata: { source: "test" } })
        )
      );
      const { status, body } = await parseResponse<SuccessBody<{ feedbackItemId: string }>>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.feedbackItemId).toBe("feedback-test-1");
    });

    it("returns 404 when unlink target does not exist", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/ideas/items/nonexistent/feedback-links/feedback-test-1`, {
          method: "DELETE",
        })
      );
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
