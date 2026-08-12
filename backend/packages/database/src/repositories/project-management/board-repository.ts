import { db, type Database } from "../../client";
import {
  boards,
  boardColumns,
  boardTemplates,
  workItems,
} from "../../schema";
import { eq, sql, asc, isNull, and, inArray } from "drizzle-orm";
import type {
  BoardWithStats,
  CreateBoardRequest,
  UpdateBoardRequest,
  CreateColumnRequest,
  UpdateColumnRequest,
  BoardTemplate,
  BoardArea,
  ColumnRole,
} from "../../domain/types";
import { getDevelopmentBoardColumns } from "../../domain/development-board-workflow";

const syncIsDoneWithRole = (role: ColumnRole | undefined, isDone: boolean | undefined) => {
  if (role === "done") return true;
  return isDone;
};

const isCanonicalDevelopmentColumns = (columns: unknown[]): boolean =>
  JSON.stringify(columns) === JSON.stringify(getDevelopmentBoardColumns());

// Helper: enrich a board with columns and totalItems
const enrichBoard = async (board: typeof boards.$inferSelect): Promise<BoardWithStats> => {
  const [columnsResult, itemsCountResult] = await Promise.all([
    db
      .select()
      .from(boardColumns)
      .where(eq(boardColumns.boardId, board.id))
      .orderBy(asc(boardColumns.order)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workItems)
      .where(and(eq(workItems.boardId, board.id), isNull(workItems.archivedAt))),
  ]);

  return {
    ...board,
    isDefault: board.isDefault ?? false,
    columns: columnsResult.map((col) => ({
      ...col,
      isDone: col.isDone ?? false,
    })),
    totalItems: itemsCountResult[0]?.count ?? 0,
  } as BoardWithStats;
};

// Provision a default "Desarrollo" board with the canonical workflow (idempotent)
export const provisionDefaultBoard = async (
  workspaceId: string,
  database: Database = db,
): Promise<{ provisioned: true; board: BoardWithStats } | { provisioned: false }> => {
  // Check if a default desarrollo board already exists
  const [existing] = await database
    .select({ id: boards.id })
    .from(boards)
    .where(
      and(
        eq(boards.workspaceId, workspaceId),
        eq(boards.isDefault, true),
        eq(boards.area, "desarrollo")
      )
    )
    .limit(1);

  if (existing) {
    return { provisioned: false };
  }

  // Create the board
  const [newBoard] = await database
    .insert(boards)
    .values({
      workspaceId,
      name: "Desarrollo",
      description: null,
      area: "desarrollo",
      isDefault: true,
    })
    .returning();

  if (!newBoard) throw new Error("Failed to provision default board");

  // Insert all canonical workflow columns
  await database.insert(boardColumns).values(
    getDevelopmentBoardColumns().map((col) => ({
      boardId: newBoard.id,
      name: col.name,
      color: col.color,
      order: col.order,
      isDone: col.isDone,
      role: col.role,
    }))
  );

  const [boardRow] = await database
    .select()
    .from(boards)
    .where(eq(boards.id, newBoard.id))
    .limit(1);
  const columnsResult = await database
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.boardId, newBoard.id))
    .orderBy(asc(boardColumns.order));
  const itemsCountResult = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(workItems)
    .where(and(eq(workItems.boardId, newBoard.id), isNull(workItems.archivedAt)));
  const board = boardRow
    ? {
        ...boardRow,
        isDefault: boardRow.isDefault ?? false,
        columns: columnsResult.map((column) => ({
          ...column,
          isDone: column.isDone ?? false,
        })),
        totalItems: itemsCountResult[0]?.count ?? 0,
      } as BoardWithStats
    : null;
  if (!board) throw new Error("Failed to retrieve provisioned board");

  return { provisioned: true, board };
};

// Get all boards (global) with columns and work item count
export const getAllBoards = async (workspaceId: string): Promise<BoardWithStats[]> => {
  const boardsResult = await db
    .select()
    .from(boards)
    .where(eq(boards.workspaceId, workspaceId))
    .orderBy(asc(boards.createdAt));

  return Promise.all(boardsResult.map((board) => enrichBoard(board)));
};

// Get single board by ID with columns and total items (org-scoped, for user-facing routes)
export const getBoardById = async (
  id: string,
  workspaceId: string
): Promise<BoardWithStats | null> => {
  const [board] = await db
    .select()
    .from(boards)
    .where(and(eq(boards.id, id), eq(boards.workspaceId, workspaceId)))
    .limit(1);

  if (!board) return null;

  return enrichBoard(board);
};

// Get single board by ID without org check (for trusted internal/background services only)
export const getBoardByIdInternal = async (
  id: string
): Promise<BoardWithStats | null> => {
  const [board] = await db
    .select()
    .from(boards)
    .where(eq(boards.id, id))
    .limit(1);

  if (!board) return null;

  return enrichBoard(board);
};

// Create a new board for a workspace
export const createBoard = async (
  workspaceId: string,
  data: CreateBoardRequest
): Promise<BoardWithStats> => {
  const area = data.area || "general";
  const [newBoard] = await db
    .insert(boards)
    .values({
      workspaceId,
      name: data.name,
      description: data.description,
      area,
      isDefault: data.isDefault || false,
      allowedTypes: data.allowedTypes ?? null,
    })
    .returning();

  if (!newBoard) throw new Error("Failed to create board");
  if (area === "desarrollo") {
    await db.insert(boardColumns).values(
      getDevelopmentBoardColumns().map((column) => ({
        boardId: newBoard.id,
        name: column.name,
        color: column.color,
        order: column.order,
        role: column.role,
        isDone: column.isDone,
      })),
    );
  }
  return getBoardById(newBoard.id, workspaceId) as Promise<BoardWithStats>;
};

// Update board
export const updateBoard = async (
  workspaceId: string,
  id: string,
  data: UpdateBoardRequest
): Promise<BoardWithStats | null> => {
  const updated = await db.transaction(async (tx) => {
    // Lock the board row so concurrent transitions cannot both insert columns.
    const [board] = await tx.select({ id: boards.id, area: boards.area }).from(boards)
      .where(and(eq(boards.id, id), eq(boards.workspaceId, workspaceId))).for("update");

    if (!board) return null;

    if (board.area !== "desarrollo" && data.area === "desarrollo") {
      const developmentColumns = await tx.select({
        name: boardColumns.name, role: boardColumns.role, order: boardColumns.order,
        color: boardColumns.color, isDone: boardColumns.isDone,
      }).from(boardColumns).where(eq(boardColumns.boardId, id))
        .orderBy(asc(boardColumns.order)).for("update");

      if (developmentColumns.length > 0 && !isCanonicalDevelopmentColumns(developmentColumns)) {
        throw new Error("Cannot move populated noncanonical board to Desarrollo");
      }

      if (developmentColumns.length === 0) {
        await tx.insert(boardColumns).values(getDevelopmentBoardColumns().map((column) => ({
          boardId: id, name: column.name, color: column.color, order: column.order,
          role: column.role, isDone: column.isDone,
        })));
      }
    }

    const [updatedBoard] = await tx.update(boards).set({ ...data, updatedAt: new Date() })
      .where(eq(boards.id, id)).returning();

    return updatedBoard ?? null;
  });

  if (!updated) return null;

  return getBoardById(id, workspaceId);
};

// Delete board
export const deleteBoard = async (workspaceId: string, id: string): Promise<boolean> => {
  // Verify board belongs to workspace
  const [boardRow] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(
      and(
        eq(boards.id, id),
        eq(boards.workspaceId, workspaceId)
      )
    )
    .limit(1);

  if (!boardRow) return false;

  const result = await db
    .delete(boards)
    .where(eq(boards.id, id))
    .returning();
  return result.length > 0;
};

// Create board from a template
export const createBoardFromTemplate = async (
  workspaceId: string,
  templateId: string,
  name?: string
): Promise<BoardWithStats | null> => {
  // Get template
  const [template] = await db
    .select()
    .from(boardTemplates)
    .where(eq(boardTemplates.id, templateId))
    .limit(1);

  if (!template) return null;

  // Create board with template's area
  const [newBoard] = await db
    .insert(boards)
    .values({
      workspaceId,
      name: name || template.name,
      description: template.description,
      area: template.area,
    })
    .returning();

  if (!newBoard) throw new Error("Failed to create board from template");

  // Create all columns from template's columns JSONB array
  const templateColumns = (template.area === "desarrollo"
    ? getDevelopmentBoardColumns()
    : template.columns) as Array<{
    name: string;
    color: string;
    order: number;
    isDone: boolean;
    role?: ColumnRole;
  }>;

  if (templateColumns.length > 0) {
    await db.insert(boardColumns).values(
      templateColumns.map((col) => ({
        boardId: newBoard.id,
        name: col.name,
        color: col.color,
        order: col.order,
        role: col.role ?? "other",
        isDone: col.isDone,
      }))
    );
  }

  return getBoardById(newBoard.id, workspaceId);
};

// Verify board belongs to workspace (shared helper for column functions)
const verifyBoardOwnership = async (
  boardId: string,
  workspaceId: string
): Promise<boolean> => {
  const [board] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.workspaceId, workspaceId)))
    .limit(1);
  return !!board;
};

// Verify column's board belongs to workspace (shared helper)
const verifyColumnOwnership = async (
  columnId: string,
  workspaceId: string
): Promise<{ boardId: string } | null> => {
  const [result] = await db
    .select({ boardId: boardColumns.boardId })
    .from(boardColumns)
    .innerJoin(boards, eq(boards.id, boardColumns.boardId))
    .where(
      and(
        eq(boardColumns.id, columnId),
        eq(boards.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return result ?? null;
};

// Get columns for a board ordered by order
export const getBoardColumns = async (boardId: string, workspaceId: string) => {
  const owned = await verifyBoardOwnership(boardId, workspaceId);
  if (!owned) return null;

  const columns = await db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.boardId, boardId))
    .orderBy(asc(boardColumns.order));

  return columns.map((col) => ({
    ...col,
    isDone: col.isDone ?? false,
  }));
};

export const getBoardColumnsByIds = async (columnIds: string[]) => {
  const uniqueIds = Array.from(new Set(columnIds)).filter(Boolean);
  if (uniqueIds.length === 0) return [];

  return db
    .select({
      id: boardColumns.id,
      name: boardColumns.name,
    })
    .from(boardColumns)
    .where(inArray(boardColumns.id, uniqueIds));
};

// Create a new column for a board
export const createColumn = async (
  boardId: string,
  workspaceId: string,
  data: CreateColumnRequest
) => {
  const owned = await verifyBoardOwnership(boardId, workspaceId);
  if (!owned) return null;

  let order = data.order;

  // If order not provided, set to max order + 1
  if (order === undefined) {
    const [maxOrderResult] = await db
      .select({ maxOrder: sql<number>`coalesce(max(${boardColumns.order}), -1)::int` })
      .from(boardColumns)
      .where(eq(boardColumns.boardId, boardId));

    order = (maxOrderResult?.maxOrder ?? -1) + 1;
  }

  const [newColumn] = await db
    .insert(boardColumns)
    .values({
      boardId,
      name: data.name,
      color: data.color || "#6366f1",
      order,
      role: data.role ?? "other",
      isDone: syncIsDoneWithRole(data.role, data.isDone) ?? false,
    })
    .returning();

  if (!newColumn) throw new Error("Failed to create column");
  return {
    ...newColumn,
    isDone: newColumn.isDone ?? false,
  };
};

// Update a column
export const updateColumn = async (
  id: string,
  workspaceId: string,
  data: UpdateColumnRequest
) => {
  const ownership = await verifyColumnOwnership(id, workspaceId);
  if (!ownership) return null;

  const nextIsDone = syncIsDoneWithRole(data.role, data.isDone);
  const [updated] = await db
    .update(boardColumns)
    .set({
      ...data,
      ...(nextIsDone !== undefined ? { isDone: nextIsDone } : {}),
      updatedAt: new Date(),
    })
    .where(eq(boardColumns.id, id))
    .returning();

  if (!updated) return null;

  return {
    ...updated,
    isDone: updated.isDone ?? false,
  };
};

// Delete a column
export const deleteColumn = async (id: string, workspaceId: string): Promise<boolean> => {
  const ownership = await verifyColumnOwnership(id, workspaceId);
  if (!ownership) return false;

  const result = await db
    .delete(boardColumns)
    .where(eq(boardColumns.id, id))
    .returning();
  return result.length > 0;
};

// Reorder columns by updating order based on array index
export const reorderColumns = async (
  boardId: string,
  workspaceId: string,
  columnIds: string[]
) => {
  const owned = await verifyBoardOwnership(boardId, workspaceId);
  if (!owned) return null;

  await Promise.all(
    columnIds.map((columnId, index) =>
      db
        .update(boardColumns)
        .set({ order: index, updatedAt: new Date() })
        .where(eq(boardColumns.id, columnId))
    )
  );

  return getBoardColumns(boardId, workspaceId);
};

// Get all board templates
export const getBoardTemplates = async (): Promise<BoardTemplate[]> => {
  const templates = await db
    .select()
    .from(boardTemplates)
    .orderBy(asc(boardTemplates.name));

  return templates.map((t) => ({
    ...t,
    isBuiltIn: t.isBuiltIn ?? false,
    columns: t.columns as BoardTemplate["columns"],
  })) as BoardTemplate[];
};

// Get all boards for a given area with columns and totalItems
export const getBoardsByArea = async (
  workspaceId: string,
  area: BoardArea
): Promise<BoardWithStats[]> => {
  const boardsResult = await db
    .select()
    .from(boards)
    .where(
      and(
        eq(boards.area, area),
        eq(boards.workspaceId, workspaceId)
      )
    )
    .orderBy(asc(boards.createdAt));

  return Promise.all(boardsResult.map((board) => enrichBoard(board)));
};
