import { db } from "../../client";
import { boards, boardColumns, projects, workItems } from "../../schema";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

export type TelegramWorkItemSummary = {
  id: string;
  taskId: string;
  title: string;
  type: string;
  priority: string;
  assignee: string | null;
  boardId: string;
  boardName: string;
  columnId: string;
  columnName: string;
  projectId: string | null;
  projectName: string | null;
};

export const getWorkItemByTaskIdExact = async (
  taskId: string
): Promise<TelegramWorkItemSummary | null> => {
  const normalized = taskId.trim();
  if (!normalized) return null;

  const [result] = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      type: workItems.type,
      priority: workItems.priority,
      assignee: workItems.assignee,
      boardId: workItems.boardId,
      boardName: boards.name,
      columnId: boardColumns.id,
      columnName: boardColumns.name,
      projectId: workItems.projectId,
      projectName: projects.name,
    })
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .leftJoin(projects, eq(workItems.projectId, projects.id))
    .where(
      and(
        isNull(workItems.archivedAt),
        sql`lower(${workItems.taskId}) = ${normalized.toLowerCase()}`
      )
    )
    .limit(1);

  return (result as TelegramWorkItemSummary) ?? null;
};

export const getInProgressWorkItemsForUser = async (
  userId: string,
  limit = 25
): Promise<TelegramWorkItemSummary[]> => {
  const safeLimit = Math.min(Math.max(limit, 1), 50);

  const results = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      type: workItems.type,
      priority: workItems.priority,
      assignee: workItems.assignee,
      boardId: workItems.boardId,
      boardName: boards.name,
      columnId: boardColumns.id,
      columnName: boardColumns.name,
      projectId: workItems.projectId,
      projectName: projects.name,
    })
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .leftJoin(projects, eq(workItems.projectId, projects.id))
    .where(
      and(
        isNull(workItems.archivedAt),
        eq(workItems.assignee, userId),
        or(
          ilike(boardColumns.name, "%progress%"),
          ilike(boardColumns.name, "%en progreso%")
        )
      )
    )
    .orderBy(desc(workItems.updatedAt))
    .limit(safeLimit);

  return results as TelegramWorkItemSummary[];
};

export const searchWorkItems = async (
  query: string,
  limit = 10
): Promise<TelegramWorkItemSummary[]> => {
  const q = query.trim();
  if (!q) return [];

  const safeLimit = Math.min(Math.max(limit, 1), 20);

  const results = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      type: workItems.type,
      priority: workItems.priority,
      assignee: workItems.assignee,
      boardId: workItems.boardId,
      boardName: boards.name,
      columnId: boardColumns.id,
      columnName: boardColumns.name,
      projectId: workItems.projectId,
      projectName: projects.name,
    })
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .leftJoin(projects, eq(workItems.projectId, projects.id))
    .where(
      and(
        isNull(workItems.archivedAt),
        or(
          ilike(workItems.title, `%${q}%`),
          ilike(workItems.description, `%${q}%`),
          ilike(workItems.taskId, `%${q}%`)
        )
      )
    )
    .orderBy(desc(workItems.createdAt))
    .limit(safeLimit);

  return results as TelegramWorkItemSummary[];
};

