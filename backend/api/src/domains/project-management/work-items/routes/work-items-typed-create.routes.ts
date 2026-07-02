import { Elysia, t } from "elysia";
import { createWorkItem, db, boards, boardColumns, eq, and, asc } from "@almirant/database";
import { getActivityLogger } from "@almirant/shared";
import { successResponse, errorResponse } from "../../../../shared/services/response";
import { wsConnectionManager } from "../../../../shared/ws/ws-connection-manager";
import { refreshResourceForecastForAffectedBlocks } from "../../../../domains/agents/services/resource-forecast";

const VALID_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const VALID_TYPES = ["epic", "feature", "story", "task", "idea"] as const;

const createTypedWorkItem = async (
  orgId: string,
  {
    id,
    projectId,
    boardId,
    boardColumnId,
    parentId,
    title,
    description,
    priority,
    assignee,
    position,
    dueDate,
    estimatedHours,
    metadata,
    tagIds,
    forcedType,
    createdByUserId,
  }: {
    id?: string;
    projectId?: string | null;
    boardId: string;
    boardColumnId: string | null;
    parentId?: string;
    forcedType: (typeof VALID_TYPES)[number];
    title: string;
    description?: string;
    priority?: string;
    assignee?: string;
    position?: number;
    dueDate?: string;
    estimatedHours?: number;
    metadata?: Record<string, unknown>;
    tagIds?: string[];
    createdByUserId?: string;
  },
  set: { status?: number | string }
) => {
  if (!title || title.trim() === "") {
    set.status = 400;
    return errorResponse("Title is required");
  }

  if (!boardId) {
    set.status = 400;
    return errorResponse("Board ID is required");
  }

  const LEAF_TYPES: readonly string[] = ["task", "idea"];
  if (!boardColumnId && LEAF_TYPES.includes(forcedType)) {
    set.status = 400;
    return errorResponse("Board column ID is required for task and idea work items");
  }

  if (priority && !VALID_PRIORITIES.includes(priority as (typeof VALID_PRIORITIES)[number])) {
    set.status = 400;
    return errorResponse("Valid priority is required (low, medium, high, urgent)");
  }

  let item;
  try {
    item = await createWorkItem(orgId, {
      id,
      projectId: projectId ?? null,
      boardId,
      boardColumnId,
      parentId,
      type: forcedType,
      title: title.trim(),
      description,
      priority: priority as (typeof VALID_PRIORITIES)[number] | undefined,
      assignee,
      position,
      dueDate,
      estimatedHours,
      metadata,
      tagIds,
      createdByUserId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("WORK_ITEM_TYPE_NOT_ALLOWED:")) {
      set.status = 400;
      return errorResponse(msg.replace(/^WORK_ITEM_TYPE_NOT_ALLOWED:\\s*/, ""));
    }
    if (msg.startsWith("PARENT_COMPLETED:")) {
      set.status = 400;
      return errorResponse(msg.replace(/^PARENT_COMPLETED:\\s*/, ""));
    }
    if (msg.startsWith("PARENT_NOT_IN_BACKLOG:")) {
      set.status = 400;
      return errorResponse(msg.replace(/^PARENT_NOT_IN_BACKLOG:\\s*/, ""));
    }
    if (
      msg.startsWith("BOARD_COLUMN_NOT_FOUND:")
      || msg.startsWith("BOARD_COLUMN_NOT_IN_BOARD:")
      || msg.startsWith("BOARD_COLUMN_NOT_IN_WORKSPACE:")
      || msg.startsWith("BOARD_COLUMN_ROLE_NOT_FOUND:")
      || msg.startsWith("BOARD_NOT_IN_WORKSPACE:")
      || msg.startsWith("PROJECT_NOT_IN_WORKSPACE:")
    ) {
      set.status = 400;
      return errorResponse(msg.replace(/^[A-Z_]+:\\s*/, ""));
    }
    throw err;
  }

  await refreshResourceForecastForAffectedBlocks(orgId, [item.id]);

  getActivityLogger().log({
    actorUserId: (createdByUserId ?? null) as string,
    workspaceId: orgId,
    action: "created",
    resourceType: "work_item",
    resourceId: item.id,
    metadata: {
      triggeredBy: "user",
      title: item.title,
      type: item.type,
      source: "web",
      processType: "manual",
      requestedByUserId: createdByUserId,
    },
  });

  wsConnectionManager.broadcastToWorkspace(orgId, {
    type: "work-item:created",
    payload: {
      workItemId: item.id,
      boardId,
      title: item.title,
      taskId: item.taskId ?? undefined,
    },
  });

  set.status = 201;
  return successResponse(item);
};

/**
 * Resolve the default board and its backlog column for a given workspace + area.
 * Returns { boardId, boardColumnId } or null if no default board is found.
 */
const resolveDefaultBoardAndBacklogColumn = async (
  workspaceId: string,
  area: "desarrollo" | "ventas" | "prospeccion" | "marketing" | "general" = "general"
): Promise<{ boardId: string; boardColumnId: string } | null> => {
  // Find the default board for the workspace in the given area
  const [defaultBoard] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.workspaceId, workspaceId), eq(boards.area, area), eq(boards.isDefault, true)))
    .limit(1);

  if (!defaultBoard) return null;

  // Find the backlog column (role = "backlog"), fallback to first column by order
  const [backlogColumn] = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(and(eq(boardColumns.boardId, defaultBoard.id), eq(boardColumns.role, "backlog")))
    .orderBy(asc(boardColumns.order))
    .limit(1);

  if (backlogColumn) {
    return { boardId: defaultBoard.id, boardColumnId: backlogColumn.id };
  }

  // Fallback: first column by order
  const [firstColumn] = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(eq(boardColumns.boardId, defaultBoard.id))
    .orderBy(asc(boardColumns.order))
    .limit(1);

  if (!firstColumn) return null;

  return { boardId: defaultBoard.id, boardColumnId: firstColumn.id };
};

export const workItemsTypedCreateRoutes = new Elysia()
  .post(
    "/tasks",
    async (ctx) => {
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = (ctx as { activeWorkspace?: { id: string } }).activeWorkspace!.id;
      return createTypedWorkItem(orgId, { ...ctx.body, forcedType: "task", createdByUserId: user?.id }, ctx.set);
    },
    {
      body: t.Object({
        id: t.Optional(t.String()),
        projectId: t.Optional(t.Nullable(t.String())),
        boardId: t.String(),
        boardColumnId: t.String(),
        parentId: t.Optional(t.String()),
        title: t.String(),
        description: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        assignee: t.Optional(t.String()),
        position: t.Optional(t.Number()),
        dueDate: t.Optional(t.String()),
        estimatedHours: t.Optional(t.Number()),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
        tagIds: t.Optional(t.Array(t.String())),
        // Explicitly ignore any client-provided type for safety/back-compat.
        type: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/stories",
    async (ctx) => {
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = (ctx as { activeWorkspace?: { id: string } }).activeWorkspace!.id;
      return createTypedWorkItem(orgId, { ...ctx.body, boardColumnId: ctx.body.boardColumnId ?? null, forcedType: "story", createdByUserId: user?.id }, ctx.set);
    },
    {
      body: t.Object({
        id: t.Optional(t.String()),
        projectId: t.Optional(t.Nullable(t.String())),
        boardId: t.String(),
        boardColumnId: t.Optional(t.Nullable(t.String())),
        parentId: t.Optional(t.String()),
        title: t.String(),
        description: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        assignee: t.Optional(t.String()),
        position: t.Optional(t.Number()),
        dueDate: t.Optional(t.String()),
        estimatedHours: t.Optional(t.Number()),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
        tagIds: t.Optional(t.Array(t.String())),
        type: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/features",
    async (ctx) => {
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = (ctx as { activeWorkspace?: { id: string } }).activeWorkspace!.id;
      return createTypedWorkItem(orgId, { ...ctx.body, boardColumnId: ctx.body.boardColumnId ?? null, forcedType: "feature", createdByUserId: user?.id }, ctx.set);
    },
    {
      body: t.Object({
        id: t.Optional(t.String()),
        projectId: t.Optional(t.Nullable(t.String())),
        boardId: t.String(),
        boardColumnId: t.Optional(t.Nullable(t.String())),
        parentId: t.Optional(t.String()),
        title: t.String(),
        description: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        assignee: t.Optional(t.String()),
        position: t.Optional(t.Number()),
        dueDate: t.Optional(t.String()),
        estimatedHours: t.Optional(t.Number()),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
        tagIds: t.Optional(t.Array(t.String())),
        type: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/epics",
    async (ctx) => {
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = (ctx as { activeWorkspace?: { id: string } }).activeWorkspace!.id;
      return createTypedWorkItem(orgId, { ...ctx.body, boardColumnId: ctx.body.boardColumnId ?? null, forcedType: "epic", createdByUserId: user?.id }, ctx.set);
    },
    {
      body: t.Object({
        id: t.Optional(t.String()),
        projectId: t.Optional(t.Nullable(t.String())),
        boardId: t.String(),
        boardColumnId: t.Optional(t.Nullable(t.String())),
        parentId: t.Optional(t.String()),
        title: t.String(),
        description: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        assignee: t.Optional(t.String()),
        position: t.Optional(t.Number()),
        dueDate: t.Optional(t.String()),
        estimatedHours: t.Optional(t.Number()),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
        tagIds: t.Optional(t.Array(t.String())),
        type: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/ideas",
    async (ctx) => {
      const user = (ctx as { user?: { id?: string } }).user;
      const orgId = (ctx as { activeWorkspace?: { id: string } }).activeWorkspace!.id;
      const { title, projectId, description, tagIds, assignee } = ctx.body;

      // Auto-resolve default board and backlog column for the workspace
      const resolved = await resolveDefaultBoardAndBacklogColumn(orgId, "general");
      if (!resolved) {
        ctx.set.status = 400;
        return errorResponse("No default board found for this workspace. Create a board and mark it as default.");
      }

      return createTypedWorkItem(
        orgId,
        {
          projectId,
          boardId: resolved.boardId,
          boardColumnId: resolved.boardColumnId,
          title,
          description,
          tagIds,
          assignee,
          forcedType: "idea",
          createdByUserId: user?.id,
        },
        ctx.set
      );
    },
    {
      body: t.Object({
        title: t.String(),
        projectId: t.Optional(t.String()),
        description: t.Optional(t.String()),
        tagIds: t.Optional(t.Array(t.String())),
        assignee: t.Optional(t.String()),
      }),
    }
  );
