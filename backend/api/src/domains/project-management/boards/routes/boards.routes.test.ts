import { afterAll, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
  createSprintReportMock,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";
import {
  testBoard,
  testBoardColumn,
  testWorkItem,
} from "../../../../test/fixtures";

// Inline helpers to avoid importing helpers.ts which has a complex type
// that causes parse errors in bun:test when elysia is mocked.
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

// -------------------------------------------------------
// Module mocks - MUST be at top level before any dynamic imports
// -------------------------------------------------------

mock.module("@almirant/database", () => createDatabaseMocks());
mock.module("../../../../shared/services/response", () => createResponseMocks());
mock.module("../../sprints/services/sprint-visual-report-service", () =>
  createSprintReportMock()
);

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { boardsRoutes } = await import("./boards.routes");
  return new Elysia().use(withTestOrg).use(boardsRoutes);
};

// =======================================================
// Board CRUD
// =======================================================
describe("boards.routes - Board CRUD", () => {
  // -------------------------------------------------------
  // GET /boards
  // -------------------------------------------------------
  describe("GET /boards", () => {
    it("returns all boards", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/boards"));
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ id: testBoard.id, name: testBoard.name });
    });
  });

  // -------------------------------------------------------
  // POST /boards
  // -------------------------------------------------------
  describe("POST /boards", () => {
    it("creates a board with valid name", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest("/boards", jsonBody({ name: "New Board" }))
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { name: string };
      }>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("New Board");
    });

    it("returns 400 when name is empty string", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest("/boards", jsonBody({ name: "" }))
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Name is required");
    });

    it("creates a board with optional fields", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/boards",
          jsonBody({
            name: "Dev Board",
            description: "Development tasks",
            area: "desarrollo",
            isDefault: true,
            allowedTypes: ["task", "story"],
          })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: Record<string, unknown>;
      }>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Dev Board");
    });
  });

  // -------------------------------------------------------
  // GET /boards/:id
  // -------------------------------------------------------
  describe("GET /boards/:id", () => {
    it("returns board when found", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest(`/boards/${testBoard.id}`));
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testBoard.id);
    });

    it("returns 404 when board not found", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/boards/non-existent-id"));
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board not found");
    });
  });

  // -------------------------------------------------------
  // PATCH /boards/:id
  // -------------------------------------------------------
  describe("PATCH /boards/:id", () => {
    it("updates board when found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}`,
          jsonBody({ name: "Updated Board" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { name: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Updated Board");
    });

    it("returns 404 when board not found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/boards/non-existent-id",
          jsonBody({ name: "Nope" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board not found");
    });
  });

  // -------------------------------------------------------
  // DELETE /boards/:id
  // -------------------------------------------------------
  describe("DELETE /boards/:id", () => {
    it("deletes board when found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/boards/${testBoard.id}`, { method: "DELETE" })
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { deleted: boolean };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it("returns 404 when board not found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest("/boards/non-existent-id", { method: "DELETE" })
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board not found");
    });
  });
});

// =======================================================
// Columns
// =======================================================
describe("boards.routes - Columns", () => {
  // -------------------------------------------------------
  // GET /boards/:id/columns
  // -------------------------------------------------------
  describe("GET /boards/:id/columns", () => {
    it("returns columns when board exists", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/boards/${testBoard.id}/columns`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ id: testBoardColumn.id });
    });

    it("returns 404 when board not found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest("/boards/non-existent-id/columns")
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board not found");
    });
  });

  // -------------------------------------------------------
  // POST /boards/:id/columns
  // -------------------------------------------------------
  describe("POST /boards/:id/columns", () => {
    it("creates column when board exists", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/columns`,
          jsonBody({ name: "In Progress", color: "#3b82f6", order: 1 })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string };
      }>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testBoardColumn.id);
    });

    it("returns 404 when board not found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/boards/non-existent-id/columns",
          jsonBody({ name: "Col" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board not found");
    });

    it("returns 400 when name is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/columns`,
          jsonBody({ name: "" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Name is required");
    });
  });

  // -------------------------------------------------------
  // PATCH /boards/:id/columns/:colId
  // -------------------------------------------------------
  describe("PATCH /boards/:id/columns/:colId", () => {
    it("updates column successfully", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/columns/${testBoardColumn.id}`,
          jsonBody({ name: "Updated Column" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testBoardColumn.id);
    });

    it("returns 404 when column not found", async () => {
      // The default mock for updateColumn always returns testBoardColumn.
      // Override via a fresh mock to simulate not-found.
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          updateColumn: async () => null,
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/columns/non-existent-col`,
          jsonBody({ name: "Nope" }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Column not found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  // -------------------------------------------------------
  // DELETE /boards/:id/columns/:colId
  // -------------------------------------------------------
  describe("DELETE /boards/:id/columns/:colId", () => {
    it("deletes column successfully", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/columns/${testBoardColumn.id}`,
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

    it("returns 404 when column not found", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          deleteColumn: async () => false,
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/columns/non-existent-col`,
          { method: "DELETE" }
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Column not found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  // -------------------------------------------------------
  // PATCH /boards/:id/columns/reorder
  // -------------------------------------------------------
  describe("PATCH /boards/:id/columns/reorder", () => {
    it("reorders columns when board exists", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/columns/reorder`,
          jsonBody({ columnIds: ["col-2", "col-1", "col-3"] }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("returns 404 when board not found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/boards/non-existent-id/columns/reorder",
          jsonBody({ columnIds: ["col-1"] }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board not found");
    });

    it("returns 400 when columnIds is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/columns/reorder`,
          jsonBody({ columnIds: [] }, "PATCH")
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("columnIds array is required");
    });
  });
});

// =======================================================
// Templates
// =======================================================
describe("boards.routes - Templates", () => {
  // -------------------------------------------------------
  // GET /boards/templates
  // -------------------------------------------------------
  describe("GET /boards/templates", () => {
    it("returns board templates", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/boards/templates"));
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // -------------------------------------------------------
  // POST /boards/from-template
  // -------------------------------------------------------
  describe("POST /boards/from-template", () => {
    it("creates board from template", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/boards/from-template",
          jsonBody({ templateId: "tpl-1", name: "My Board" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string };
      }>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(testBoard.id);
    });

    it("returns 400 when templateId is empty", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          "/boards/from-template",
          jsonBody({ templateId: "" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("templateId is required");
    });

    it("returns 404 when template not found", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          createBoardFromTemplate: async () => null,
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(
          "/boards/from-template",
          jsonBody({ templateId: "non-existent-tpl" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board template not found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

});

// =======================================================
// Area
// =======================================================
describe("boards.routes - Area", () => {
  // -------------------------------------------------------
  // GET /boards/area/:area
  // -------------------------------------------------------
  describe("GET /boards/area/:area", () => {
    it("returns boards for valid area", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/boards/area/desarrollo"));
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
    });

    it("returns boards for each valid area", async () => {
      const app = await makeApp();
      const validAreas = ["desarrollo", "ventas", "prospeccion", "marketing", "general"];

      for (const area of validAreas) {
        const res = await app.handle(makeRequest(`/boards/area/${area}`));
        const { status, body } = await parseResponse<{
          success: boolean;
        }>(res);

        expect(status).toBe(200);
        expect(body.success).toBe(true);
      }
    });

    it("returns 400 for invalid area", async () => {
      const app = await makeApp();
      const res = await app.handle(makeRequest("/boards/area/invalid-area"));
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Invalid area");
    });
  });
});

// =======================================================
// Sprints
// =======================================================
describe("boards.routes - Sprints", () => {
  // -------------------------------------------------------
  // GET /boards/:id/sprints
  // -------------------------------------------------------
  describe("GET /boards/:id/sprints", () => {
    it("returns sprints for a board", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/boards/${testBoard.id}/sprints`)
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

  // -------------------------------------------------------
  // POST /boards/:id/sprints
  // -------------------------------------------------------
  describe("POST /boards/:id/sprints", () => {
    it("creates a sprint", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints`,
          jsonBody({
            name: "Sprint 1",
            startDate: "2025-01-01",
            endDate: "2025-01-15",
          })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string; name: string };
      }>(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("sprint-1");
      expect(body.data.name).toBe("Sprint 1");
    });

    it("returns 409 when createSprint throws", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          createSprint: async () => {
            throw new Error("Active sprint already exists");
          },
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints`,
          jsonBody({ name: "Sprint 2" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(409);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Active sprint already exists");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  // -------------------------------------------------------
  // GET /boards/:id/sprints/active
  // -------------------------------------------------------
  describe("GET /boards/:id/sprints/active", () => {
    it("returns active sprint (null when none)", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/boards/${testBoard.id}/sprints/active`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown;
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toBeNull();
    });

    it("returns active sprint when one exists", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getActiveSprint: async () => ({
            id: "sprint-active",
            name: "Sprint 3",
            status: "active",
          }),
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(`/boards/${testBoard.id}/sprints/active`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string; name: string; status: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe("sprint-active");
      expect(body.data.status).toBe("active");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  // -------------------------------------------------------
  // GET /boards/:id/sprints/next-number
  // -------------------------------------------------------
  describe("GET /boards/:id/sprints/next-number", () => {
    it("returns next sprint number", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/boards/${testBoard.id}/sprints/next-number`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { nextNumber: number };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.nextNumber).toBe(1);
    });
  });

  // -------------------------------------------------------
  // GET /boards/:id/sprints/done-preview
  // -------------------------------------------------------
  describe("GET /boards/:id/sprints/done-preview", () => {
    it("returns done items preview without date range", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/boards/${testBoard.id}/sprints/done-preview`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("returns completed items by date range when from/to provided", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/done-preview?from=2025-01-01&to=2025-01-31`
        )
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

  // -------------------------------------------------------
  // POST /boards/:id/sprints/close-by-date
  // -------------------------------------------------------
  describe("POST /boards/:id/sprints/close-by-date", () => {
    it("closes sprint by date range", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/close-by-date`,
          jsonBody({
            name: "Sprint 1",
            startDate: "2025-01-01",
            endDate: "2025-01-15",
          })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string; status: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("closed");
    });

    it("returns 500 when closeSprintByDate throws", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          closeSprintByDate: async () => {
            throw new Error("No completed items found");
          },
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/close-by-date`,
          jsonBody({
            name: "Sprint X",
            startDate: "2025-01-01",
            endDate: "2025-01-15",
          })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toContain("No completed items found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  // -------------------------------------------------------
  // POST /boards/:id/sprints/close-adhoc
  // -------------------------------------------------------
  describe("POST /boards/:id/sprints/close-adhoc", () => {
    it("closes sprint ad-hoc", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/close-adhoc`,
          jsonBody({ name: "Sprint Ad-hoc" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string; status: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("closed");
    });

    it("passes date range options when provided", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/close-adhoc`,
          jsonBody({
            name: "Sprint Ad-hoc Dated",
            startDate: "2025-01-01",
            endDate: "2025-01-15",
          })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("returns 500 when closeSprintAdHoc throws", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          closeSprintAdHoc: async () => {
            throw new Error("Board has no done column");
          },
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/close-adhoc`,
          jsonBody({ name: "Sprint Fail" })
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board has no done column");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  // -------------------------------------------------------
  // POST /boards/:id/sprints/:sprintId/close
  // -------------------------------------------------------
  describe("POST /boards/:id/sprints/:sprintId/close", () => {
    it("closes a planned sprint", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getSprintById: async () => ({
            id: "sprint-1",
            name: "Sprint 1",
            status: "active",
          }),
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/sprint-1/close`,
          jsonBody({})
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: { id: string; status: string };
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("closed");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns 404 when sprint not found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/non-existent/close`,
          jsonBody({})
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Sprint not found");
    });

    it("returns 409 when sprint is already closed", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getSprintById: async () => ({
            id: "sprint-1",
            name: "Sprint 1",
            status: "closed",
          }),
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/sprint-1/close`,
          jsonBody({})
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(409);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Sprint is already closed");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns 500 when closeSprint throws", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getSprintById: async () => ({
            id: "sprint-1",
            name: "Sprint 1",
            status: "active",
          }),
          closeSprint: async () => {
            throw new Error("Unexpected DB error");
          },
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/sprint-1/close`,
          jsonBody({})
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Unexpected DB error");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });
  });

  // -------------------------------------------------------
  // GET /boards/:id/sprints/:sprintId/work-items
  // -------------------------------------------------------
  describe("GET /boards/:id/sprints/:sprintId/work-items", () => {
    it("returns work items for a sprint", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getSprintById: async () => ({
            id: "sprint-1",
            name: "Sprint 1",
            status: "active",
          }),
          getSprintWorkItems: async () => [testWorkItem],
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest(`/boards/${testBoard.id}/sprints/sprint-1/work-items`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("returns 404 when sprint not found", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/sprints/non-existent/work-items`
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Sprint not found");
    });
  });
});

// =======================================================
// Work Items by Board
// =======================================================
describe("boards.routes - Work Items", () => {
  // -------------------------------------------------------
  // GET /boards/:id/work-items
  // -------------------------------------------------------
  describe("GET /boards/:id/work-items", () => {
    it("returns work items grouped by column", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(`/boards/${testBoard.id}/work-items`)
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: Array<{ column: unknown; items: unknown[]; count: number }>;
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      const firstGroup = body.data[0];
      expect(firstGroup).toBeDefined();
      if (!firstGroup) throw new Error("Expected at least one column group");
      expect(firstGroup.count).toBe(1);
    });

    it("returns 404 when board has no columns (empty result)", async () => {
      mock.module("@almirant/database", () =>
        createDatabaseMocks({
          getWorkItemsByBoard: async () => [],
        })
      );

      const { Elysia } = await import("elysia");
      const { boardsRoutes } = await import("./boards.routes");
      const app = new Elysia().use(withTestOrg).use(boardsRoutes);

      const res = await app.handle(
        makeRequest("/boards/non-existent-id/work-items")
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        error: string;
      }>(res);

      expect(status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toContain("Board not found");

      // Restore default mocks
      mock.module("@almirant/database", () => createDatabaseMocks());
    });

    it("passes filter query parameters to repository", async () => {
      const app = await makeApp();
      const res = await app.handle(
        makeRequest(
          `/boards/${testBoard.id}/work-items?search=test&type=task&priority=high&assignee=user-1&projectId=proj-1&tagIds=tag-1`
        )
      );
      const { status, body } = await parseResponse<{
        success: boolean;
        data: unknown[];
      }>(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
