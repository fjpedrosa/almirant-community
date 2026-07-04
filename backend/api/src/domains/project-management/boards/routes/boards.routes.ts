import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  getAllBoards,
  getBoardById,
  createBoard,
  updateBoard,
  deleteBoard,
  getBoardColumns,
  createColumn,
  updateColumn,
  deleteColumn,
  reorderColumns,
  createBoardFromTemplate,
  getWorkItemsByBoard,
  getWorkItemsByArea,
  getBoardTemplates,
  getBoardsByArea,
  provisionDefaultBoard,
  getSprintsByBoard,
  getActiveSprint,
  getSprintById,
  createSprint as createSprintRepo,
  closeSprint as closeSprintRepo,
  closeSprintAdHoc as closeSprintAdHocRepo,
  getSprintWorkItems,
  getNextSprintNumber,
  getDoneItemsPreview,
  closeSprintByDate as closeSprintByDateRepo,
  getCompletedWorkItemsByDateRange,
} from "@almirant/database";
import type { WorkItemBoardFilters } from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";
import { kickoffSprintVisualReportGeneration } from "../../sprints/services/sprint-visual-report-service";
import { kickoffSprintChangelogGeneration } from "../../sprints/services/sprint-changelog-service";

const VALID_AREAS = [
  "desarrollo",
  "ventas",
  "prospeccion",
  "marketing",
  "general",
] as const;

export const boardsRoutes = new Elysia({ prefix: "/boards" })
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // GET /boards - List all boards (global)
  // -------------------------------------------------------
  .get("/", async ({ activeWorkspace }) => {
    const orgId = activeWorkspace!.id;
    const boards = await getAllBoards(orgId);
    return successResponse(boards);
  })

  // -------------------------------------------------------
  // POST /boards - Create a board for the workspace
  // -------------------------------------------------------
  .post(
    "/",
    async ({ body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      if (!body.name || body.name.trim() === "") {
        set.status = 400;
        return errorResponse("Name is required");
      }

      const board = await createBoard(orgId, {
        name: body.name.trim(),
        description: body.description,
        area: body.area as "desarrollo" | "ventas" | "prospeccion" | "marketing" | "general" | undefined,
        isDefault: body.isDefault,
        allowedTypes: body.allowedTypes,
      });

      set.status = 201;
      return successResponse(board);
    },
    {
      body: t.Object({
        name: t.String(),
        description: t.Optional(t.String()),
        area: t.Optional(t.String()),
        isDefault: t.Optional(t.Boolean()),
        allowedTypes: t.Optional(
          t.Array(t.Union([t.Literal("epic"), t.Literal("feature"), t.Literal("story"), t.Literal("task"), t.Literal("idea")]))
        ),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /boards/from-template - Create board from template
  // -------------------------------------------------------
  .post(
    "/from-template",
    async ({ body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      if (!body.templateId || body.templateId.trim() === "") {
        set.status = 400;
        return errorResponse("templateId is required");
      }

      const board = await createBoardFromTemplate(
        orgId,
        body.templateId.trim(),
        body.name
      );

      if (!board) {
        set.status = 404;
        return notFoundResponse("Board template");
      }

      set.status = 201;
      return successResponse(board);
    },
    {
      body: t.Object({
        templateId: t.String(),
        name: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /boards/provision - Provision default board (idempotent)
  // (MUST be before /:id to avoid matching "provision" as id)
  // -------------------------------------------------------
  .post(
    "/provision",
    async ({ set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const result = await provisionDefaultBoard(orgId);

        if (!result.provisioned) {
          return successResponse({ provisioned: false, message: "Already provisioned" });
        }

        set.status = 201;
        return successResponse({ provisioned: true, board: result.board });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to provision default board",
          500
        );
      }
    }
  )

  // -------------------------------------------------------
  // GET /boards/templates - List all board templates
  // (MUST be before /:id to avoid matching "templates" as id)
  // -------------------------------------------------------
  .get("/templates", async () => {
    const templates = await getBoardTemplates();
    return successResponse(templates);
  })

  // -------------------------------------------------------
  // GET /boards/area/:area - List boards by area
  // (MUST be before /:id to avoid matching "area" as id)
  // -------------------------------------------------------
  .get(
    "/area/:area",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      if (!VALID_AREAS.includes(params.area as (typeof VALID_AREAS)[number])) {
        set.status = 400;
        return errorResponse(
          `Invalid area. Must be one of: ${VALID_AREAS.join(", ")}`
        );
      }

      const boards = await getBoardsByArea(
        orgId,
        params.area as (typeof VALID_AREAS)[number]
      );
      return successResponse(boards);
    },
    {
      params: t.Object({
        area: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /boards/area/:area/work-items - Cross-board work items by area (unified Kanban)
  // (MUST be before /:id to avoid matching "area" as id)
  // -------------------------------------------------------
  .get(
    "/area/:area/work-items",
    async ({ params, query, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      if (!VALID_AREAS.includes(params.area as (typeof VALID_AREAS)[number])) {
        set.status = 400;
        return errorResponse(
          `Invalid area. Must be one of: ${VALID_AREAS.join(", ")}`
        );
      }

      const filters: WorkItemBoardFilters = {};
      if (query.search) filters.search = query.search;
      if (query.type) filters.type = query.type as WorkItemBoardFilters["type"];
      if (query.priority) filters.priority = query.priority as WorkItemBoardFilters["priority"];
      if (query.assignee) filters.assignee = query.assignee;
      if (query.projectId) filters.projectId = query.projectId;
      if (query.tagIds) filters.tagIds = query.tagIds;

      const hasFilters = Object.keys(filters).length > 0;
      // Opt-in slim board DTO: `?view=board` drops description + heavy metadata
      // blobs the card never renders (detail panel refetches the full row).
      const slim = query.view === "board";
      const columns = await getWorkItemsByArea(
        orgId,
        params.area as (typeof VALID_AREAS)[number],
        hasFilters ? filters : undefined,
        { slim }
      );

      return successResponse(columns);
    },
    {
      params: t.Object({
        area: t.String(),
      }),
      query: t.Object({
        search: t.Optional(t.String()),
        type: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        assignee: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        tagIds: t.Optional(t.String()),
        view: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /boards/:id/sprints - List sprints for a board
  // (MUST be before /:id to avoid matching "sprints" as id)
  // -------------------------------------------------------
  .get(
    "/:id/sprints",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }
      const sprintsList = await getSprintsByBoard(orgId, params.id);
      return successResponse(sprintsList);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /boards/:id/sprints/active - Get active sprint for a board
  // -------------------------------------------------------
  .get(
    "/:id/sprints/active",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }
      const sprint = await getActiveSprint(orgId, params.id);
      return successResponse(sprint);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /boards/:id/sprints/next-number - Get next sprint number
  // -------------------------------------------------------
  .get(
    "/:id/sprints/next-number",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }
      const nextNumber = await getNextSprintNumber(orgId, params.id);
      return successResponse({ nextNumber });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /boards/:id/sprints/done-preview - Preview done items for close dialog
  // -------------------------------------------------------
  .get(
    "/:id/sprints/done-preview",
    async ({ params, query, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }
      if (query.from && query.to) {
        // endDate should include the entire day (set to 23:59:59.999)
        const endOfDay = new Date(query.to);
        endOfDay.setUTCHours(23, 59, 59, 999);
        const items = await getCompletedWorkItemsByDateRange(
          orgId,
          params.id,
          new Date(query.from),
          endOfDay
        );
        return successResponse(items);
      }
      const items = await getDoneItemsPreview(orgId, params.id);
      return successResponse(items);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /boards/:id/sprints - Create a planned sprint
  // -------------------------------------------------------
  .post(
    "/:id/sprints",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }
      try {
        const sprint = await createSprintRepo(orgId, {
          boardId: params.id,
          name: body.name,
          startDate: body.startDate,
          endDate: body.endDate,
        });
        set.status = 201;
        return successResponse(sprint);
      } catch (err) {
        set.status = 409;
        return errorResponse(
          err instanceof Error ? err.message : "Error creating sprint"
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.String(),
        startDate: t.Optional(t.String()),
        endDate: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /boards/:id/sprints/close-by-date - Close sprint filtered by date range
  // (MUST be before /:id/sprints/:sprintId to avoid matching as sprintId)
  // -------------------------------------------------------
  .post(
    "/:id/sprints/close-by-date",
    async ({ params, body, set, user, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }
      try {
        const sprint = await closeSprintByDateRepo(
          orgId,
          params.id,
          body.name,
          body.startDate,
          body.endDate
        );
        kickoffSprintVisualReportGeneration({
          sprintId: sprint.id,
          boardId: params.id,
          sprintName: sprint.name,
        });
        kickoffSprintChangelogGeneration({
          sprintId: sprint.id,
          boardId: params.id,
          sprintName: sprint.name,
          locale: user?.locale ?? "es",
        });
        return successResponse(sprint);
      } catch (err) {
        set.status = 500;
        return errorResponse(
          err instanceof Error ? err.message : "Error closing sprint by date"
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.String(),
        startDate: t.String(),
        endDate: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /boards/:id/sprints/close-adhoc - Create + close sprint ad-hoc
  // (MUST be before /:id/sprints/:sprintId to avoid matching "close-adhoc" as sprintId)
  // -------------------------------------------------------
  .post(
    "/:id/sprints/close-adhoc",
    async ({ params, body, set, user, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }
      try {
        const options = body.startDate || body.endDate
          ? { startDate: body.startDate, endDate: body.endDate }
          : undefined;
        const sprint = await closeSprintAdHocRepo(orgId, params.id, body.name, options);
        kickoffSprintVisualReportGeneration({
          sprintId: sprint.id,
          boardId: params.id,
          sprintName: sprint.name,
        });
        kickoffSprintChangelogGeneration({
          sprintId: sprint.id,
          boardId: params.id,
          sprintName: sprint.name,
          locale: user?.locale ?? "es",
        });
        return successResponse(sprint);
      } catch (err) {
        set.status = 500;
        return errorResponse(
          err instanceof Error ? err.message : "Error closing sprint"
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.String(),
        startDate: t.Optional(t.String()),
        endDate: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /boards/:id/sprints/:sprintId/close - Close a planned sprint
  // -------------------------------------------------------
  .post(
    "/:id/sprints/:sprintId/close",
    async ({ params, body, set, user, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }
      const sprint = await getSprintById(orgId, params.sprintId);
      if (!sprint) {
        set.status = 404;
        return notFoundResponse("Sprint");
      }
      if (sprint.status === "closed") {
        set.status = 409;
        return errorResponse("Sprint is already closed");
      }
      try {
        const options = body.startDate || body.endDate
          ? { startDate: body.startDate, endDate: body.endDate }
          : undefined;
        const closed = await closeSprintRepo(orgId, params.sprintId, params.id, options);
        kickoffSprintVisualReportGeneration({
          sprintId: closed.id,
          boardId: params.id,
          sprintName: closed.name,
        });
        kickoffSprintChangelogGeneration({
          sprintId: closed.id,
          boardId: params.id,
          sprintName: closed.name,
          locale: user?.locale ?? "es",
        });
        return successResponse(closed);
      } catch (err) {
        set.status = 500;
        return errorResponse(
          err instanceof Error ? err.message : "Error closing sprint"
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
        sprintId: t.String(),
      }),
      body: t.Object({
        startDate: t.Optional(t.String()),
        endDate: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /boards/:id/sprints/:sprintId/work-items - Get work items for a sprint
  // -------------------------------------------------------
  .get(
    "/:id/sprints/:sprintId/work-items",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }
      const sprint = await getSprintById(orgId, params.sprintId);
      if (!sprint) {
        set.status = 404;
        return notFoundResponse("Sprint");
      }
      const items = await getSprintWorkItems(orgId, params.sprintId);
      return successResponse(items);
    },
    {
      params: t.Object({
        id: t.String(),
        sprintId: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /boards/:id - Get board by ID
  // -------------------------------------------------------
  .get(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);

      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }

      return successResponse(board);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // PATCH /boards/:id - Update board
  // -------------------------------------------------------
  .patch(
    "/:id",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await updateBoard(orgId, params.id, {
        name: body.name,
        description: body.description,
        area: body.area as "desarrollo" | "ventas" | "prospeccion" | "marketing" | "general" | undefined,
        isDefault: body.isDefault,
        allowedTypes: body.allowedTypes,
      });

      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }

      return successResponse(board);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.Nullable(t.String())),
        area: t.Optional(t.String()),
        isDefault: t.Optional(t.Boolean()),
        allowedTypes: t.Optional(
          t.Nullable(
            t.Array(t.Union([t.Literal("epic"), t.Literal("feature"), t.Literal("story"), t.Literal("task"), t.Literal("idea")]))
          )
        ),
      }),
    }
  )

  // -------------------------------------------------------
  // DELETE /boards/:id - Delete board
  // -------------------------------------------------------
  .delete(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const deleted = await deleteBoard(orgId, params.id);

      if (!deleted) {
        set.status = 404;
        return notFoundResponse("Board");
      }

      return successResponse({ deleted: true });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /boards/:id/columns - List columns for board
  // -------------------------------------------------------
  .get(
    "/:id/columns",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);

      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }

      const columns = await getBoardColumns(params.id, orgId);
      return successResponse(columns);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /boards/:id/columns - Create column for board
  // -------------------------------------------------------
  .post(
    "/:id/columns",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);

      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }

      if (!body.name || body.name.trim() === "") {
        set.status = 400;
        return errorResponse("Name is required");
      }

      const column = await createColumn(params.id, orgId, {
        name: body.name.trim(),
        color: body.color,
        order: body.order,
        isDone: body.isDone,
        role: body.role,
      });

      set.status = 201;
      return successResponse(column);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.String(),
        color: t.Optional(t.String()),
        order: t.Optional(t.Number()),
        isDone: t.Optional(t.Boolean()),
        role: t.Optional(
          t.Union([
            t.Literal("backlog"),
            t.Literal("todo"),
            t.Literal("in_progress"),
            t.Literal("review"),
            t.Literal("testing"),
            t.Literal("needs_fix"),
            t.Literal("validating"),
            t.Literal("to_document"),
            t.Literal("done"),
            t.Literal("other"),
          ])
        ),
      }),
    }
  )

  // -------------------------------------------------------
  // PATCH /boards/:id/columns/reorder - Reorder columns
  // (MUST be before /:id/columns/:colId to avoid matching "reorder" as colId)
  // -------------------------------------------------------
  .patch(
    "/:id/columns/reorder",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);

      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }

      if (!body.columnIds || body.columnIds.length === 0) {
        set.status = 400;
        return errorResponse("columnIds array is required");
      }

      const columns = await reorderColumns(params.id, orgId, body.columnIds);
      return successResponse(columns);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        columnIds: t.Array(t.String()),
      }),
    }
  )

  // -------------------------------------------------------
  // PATCH /boards/:id/columns/:colId - Update column
  // -------------------------------------------------------
  .patch(
    "/:id/columns/:colId",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }

      const column = await updateColumn(params.colId, orgId, {
        name: body.name,
        color: body.color,
        order: body.order,
        isDone: body.isDone,
        role: body.role,
      });

      if (!column) {
        set.status = 404;
        return notFoundResponse("Column");
      }

      return successResponse(column);
    },
    {
      params: t.Object({
        id: t.String(),
        colId: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        color: t.Optional(t.String()),
        order: t.Optional(t.Number()),
        isDone: t.Optional(t.Boolean()),
        role: t.Optional(
          t.Union([
            t.Literal("backlog"),
            t.Literal("todo"),
            t.Literal("in_progress"),
            t.Literal("review"),
            t.Literal("testing"),
            t.Literal("needs_fix"),
            t.Literal("validating"),
            t.Literal("to_document"),
            t.Literal("done"),
            t.Literal("other"),
          ])
        ),
      }),
    }
  )

  // -------------------------------------------------------
  // DELETE /boards/:id/columns/:colId - Delete column
  // -------------------------------------------------------
  .delete(
    "/:id/columns/:colId",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const board = await getBoardById(params.id, orgId);
      if (!board) {
        set.status = 404;
        return notFoundResponse("Board");
      }

      const deleted = await deleteColumn(params.colId, orgId);

      if (!deleted) {
        set.status = 404;
        return notFoundResponse("Column");
      }

      return successResponse({ deleted: true });
    },
    {
      params: t.Object({
        id: t.String(),
        colId: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /boards/:id/work-items - Get work items by board (Kanban view)
  // -------------------------------------------------------
  .get(
    "/:id/work-items",
    async ({ params, query, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const filters: WorkItemBoardFilters = {};

      if (query.search) filters.search = query.search;
      if (query.type) filters.type = query.type as WorkItemBoardFilters["type"];
      if (query.priority) filters.priority = query.priority as WorkItemBoardFilters["priority"];
      if (query.assignee) filters.assignee = query.assignee;
      if (query.projectId) filters.projectId = query.projectId;
      if (query.tagIds) filters.tagIds = query.tagIds;
      if (query.sprintId) filters.sprintId = query.sprintId;

      const hasFilters = Object.keys(filters).length > 0;
      // Opt-in slim board DTO: `?view=board` drops description + heavy metadata
      // blobs the card never renders (detail panel refetches the full row).
      const slim = query.view === "board";
      const columns = await getWorkItemsByBoard(
        orgId,
        params.id,
        hasFilters ? filters : undefined,
        { slim }
      );

      if (columns.length === 0) {
        set.status = 404;
        return notFoundResponse("Board");
      }

      return successResponse(columns);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        search: t.Optional(t.String()),
        type: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        assignee: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        tagIds: t.Optional(t.String()),
        sprintId: t.Optional(t.String()),
        view: t.Optional(t.String()),
      }),
    }
  );
