import { afterAll, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";
import { testSeed, testWorkItem } from "../../../../test/fixtures";

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
mock.module("../../../../shared/services/response", () => createResponseMocks());
mock.module("../../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../../../shared/services/notification-service", () => ({
  sendMentionNotification: async () => {},
  sendNotificationBatch: async () => {},
}));

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { seedsRoutes } = await import("./seeds.routes");
  return new Elysia().use(withTestOrg).use(seedsRoutes);
};

type SuccessBody<T = unknown> = { success: true; data: T; meta?: unknown };
type ErrorBody = { success: false; error: string };

describe("seedsRoutes", () => {
  // ── GET /seeds/ ──────────────────────────────────────────────────────

  describe("GET /seeds/", () => {
    it("returns paginated seeds list", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/seeds/?page=1&limit=10"));
      const { status, body } = await parseResponse<
        SuccessBody<{ id: string }[]> & { meta: { page: number; limit: number; total: number } }
      >(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe(testSeed.id);
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(10);
      expect(body.meta.total).toBe(1);
    });

    it("accepts statusGroup=active query param", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/seeds/?statusGroup=active"));
      const { status, body } = await parseResponse<SuccessBody<{ id: string }[]>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
    });

    it("accepts statusGroup=finished query param", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/seeds/?statusGroup=finished"));
      const { status, body } = await parseResponse<SuccessBody<{ id: string }[]>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
    });

    it("accepts comma-separated statuses query param", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/seeds/?statuses=draft,active"));
      const { status, body } = await parseResponse<SuccessBody<{ id: string }[]>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
    });

    it("accepts single status query param for backward compatibility", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/seeds/?status=draft"));
      const { status, body } = await parseResponse<SuccessBody<{ id: string }[]>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
    });

    it("combines statusGroup with other filters", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest("/seeds/?statusGroup=active&search=test&projectId=proj-test-1")
      );
      const { status, body } = await parseResponse<SuccessBody<{ id: string }[]>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ── GET /seeds/:id ───────────────────────────────────────────────────

  describe("GET /seeds/:id", () => {
    it("returns seed by ID", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest(`/seeds/${testSeed.id}`));
      const { status, body } = await parseResponse<SuccessBody<{ id: string; title: string }>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testSeed.id);
      expect(body.data.title).toBe(testSeed.title);
    });

    it("returns 404 for non-existent seed", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/seeds/nonexistent"));
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  // ── POST /seeds/ ─────────────────────────────────────────────────────

  describe("POST /seeds/", () => {
    it("creates a seed", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/seeds/",
          jsonBody({
            title: "New Seed",
            projectId: "proj-test-1",
          })
        )
      );
      const { status, body } = await parseResponse<SuccessBody<{ title: string }>>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
    });

    it("returns 400 when title is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/seeds/",
          jsonBody({ title: "   " })
        )
      );
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Title is required");
    });
  });

  // ── PATCH /seeds/:id ─────────────────────────────────────────────────

  describe("PATCH /seeds/:id", () => {
    it("updates a seed", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/seeds/${testSeed.id}`,
          jsonBody({ title: "Updated Seed" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<SuccessBody<{ id: string }>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("returns 404 for non-existent seed", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/seeds/nonexistent",
          jsonBody({ title: "Updated" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  // ── DELETE /seeds/:id ────────────────────────────────────────────────

  describe("DELETE /seeds/:id", () => {
    it("deletes a seed", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/seeds/${testSeed.id}`, { method: "DELETE" })
      );
      const { status, body } = await parseResponse<SuccessBody<{ deleted: boolean }>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it("returns 404 for non-existent seed", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest("/seeds/nonexistent", { method: "DELETE" })
      );
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  // ── PATCH /seeds/:id/status ──────────────────────────────────────────

  describe("PATCH /seeds/:id/status", () => {
    it("changes seed status", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/seeds/${testSeed.id}/status`,
          jsonBody({ status: "approved" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<SuccessBody<{ status: string }>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("approved");
    });

    it("returns 404 for non-existent seed", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/seeds/nonexistent/status",
          jsonBody({ status: "approved" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<ErrorBody>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("not found");
    });
  });

  // ── GET /seeds/selected ──────────────────────────────────────────────

  describe("GET /seeds/selected", () => {
    it("returns seeds selected for ideation", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/seeds/selected"));
      const { status, body } = await parseResponse<SuccessBody<{ id: string }[]>>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe(testSeed.id);
    });
  });

  // ── POST /seeds/:id/promote ──────────────────────────────────────────

  describe("POST /seeds/:id/promote", () => {
    it("promotes seed to work item", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/seeds/${testSeed.id}/promote`,
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
          source: { id: string };
          workItem: { id: string };
          link: { seedId: string; workItemId: string };
        }>
      >(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.source.id).toBe(testSeed.id);
      expect(body.data.workItem.id).toBe(testWorkItem.id);
    });

    it("returns 404 when seed does not exist", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/seeds/nonexistent/promote",
          jsonBody({
            workItemType: "task",
            title: "Promoted task",
            boardId: "board-test-1",
            projectId: "proj-test-1",
          })
        )
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
