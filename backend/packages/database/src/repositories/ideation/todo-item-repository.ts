import { db } from "../../client";
import {
  todoItems,
  todoItemTags,
  tags,
  projects,
  user,
  member,
} from "../../schema";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { PaginationParams } from "../../domain/types";
import type { NewEntityEvent } from "../../schema/entity-events";
import {
  createEntityEvents,
  serializeEntityEventValue,
  getEntityCommentCount,
  getLastEntityComment,
} from "..";
import type { LastCommentInfo } from "..";

// ── Types ──────────────────────────────────────────────────────────────

export type TodoItemStatus = "pending" | "in_progress" | "done" | "blocked";

export interface TodoItemFilters {
  status?: TodoItemStatus;
  priority?: string;
  ownerUserId?: string | string[];
  projectId?: string;
  search?: string;
  dueDate?: string;
  showAllDone?: boolean;
  sortBy?: "priority" | "createdAt" | "updatedAt" | "dueDate";
  sortOrder?: "asc" | "desc";
}

export interface TodoItemEventContext {
  triggeredBy?: "user" | "system" | "claude-code" | "codex";
  triggeredByUserId?: string | null;
}

export interface CreateTodoItemRequest {
  projectId?: string | null;
  title: string;
  description?: string | null;
  status?: TodoItemStatus;
  priority?: "low" | "medium" | "high" | "urgent" | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateTodoItemRequest {
  projectId?: string | null;
  title?: string;
  description?: string | null;
  status?: TodoItemStatus;
  priority?: "low" | "medium" | "high" | "urgent" | null;
  ownerUserId?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TodoItemWithRelations {
  id: string;
  organizationId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  ownerUserId: string | null;
  createdByUserId: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  owner: { id: string; name: string; email: string; image: string | null } | null;
  createdBy: { id: string; name: string; email: string; image: string | null } | null;
  projectName: string | null;
  commentCount: number;
  lastComment: LastCommentInfo | null;
  tags: { id: string; name: string; color: string }[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

const defaultEventContext: TodoItemEventContext = {
  triggeredBy: "system",
};

const resolveEventContext = (
  context: TodoItemEventContext = defaultEventContext
): Required<Pick<TodoItemEventContext, "triggeredBy">> & { triggeredByUserId: string | null } => ({
  triggeredBy: context.triggeredBy ?? (context.triggeredByUserId ? "user" : "system"),
  triggeredByUserId: context.triggeredByUserId ?? null,
});

const insertEntityEvents = async (events: NewEntityEvent[]): Promise<void> => {
  await createEntityEvents(events);
};

const parseDueDateFilter = (raw?: string): { start: Date; end: Date } | null => {
  if (!raw) return null;
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return null;
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

const ensureOwnerBelongsToOrganization = async (
  organizationId: string,
  ownerUserId: string
): Promise<void> => {
  const [ownerMembership] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, ownerUserId)
      )
    )
    .limit(1);

  if (!ownerMembership) {
    throw new Error("OWNER_NOT_MEMBER");
  }
};

const ensureProjectBelongsToOrganization = async (
  organizationId: string,
  projectId: string
): Promise<void> => {
  const [projectRow] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!projectRow) {
    throw new Error("PROJECT_NOT_IN_ORGANIZATION");
  }
};

type TodoItemRow = typeof todoItems.$inferSelect;

const hydrateTodoItemRelations = async (
  item: TodoItemRow
): Promise<TodoItemWithRelations> => {
  const [ownerRow, createdByRow, projectRow, commentCount, lastComment, tagsResult] = await Promise.all([
    item.ownerUserId
      ? db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          })
          .from(user)
          .where(eq(user.id, item.ownerUserId))
          .limit(1)
      : Promise.resolve([]),
    item.createdByUserId
      ? db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          })
          .from(user)
          .where(eq(user.id, item.createdByUserId))
          .limit(1)
      : Promise.resolve([]),
    item.projectId
      ? db
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, item.projectId))
          .limit(1)
      : Promise.resolve([]),
    getEntityCommentCount("todo", item.id),
    getLastEntityComment("todo", item.id),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(todoItemTags)
      .innerJoin(tags, eq(todoItemTags.tagId, tags.id))
      .where(eq(todoItemTags.todoItemId, item.id)),
  ]);

  return {
    ...item,
    owner: ownerRow[0] ?? null,
    createdBy: createdByRow[0] ?? null,
    projectName: projectRow[0]?.name ?? null,
    commentCount,
    lastComment,
    tags: tagsResult,
  };
};

// ── CRUD ────────────────────────────────────────────────────────────────

export const getTodoItems = async (
  organizationId: string,
  pagination: PaginationParams,
  filters?: TodoItemFilters
): Promise<{ items: TodoItemWithRelations[]; total: number }> => {
  const conditions = [
    eq(todoItems.organizationId, organizationId),
    sql`(${todoItems.projectId} IS NULL OR ${todoItems.projectId} IN (SELECT id FROM projects WHERE organization_id = ${organizationId} AND status != 'archived'))`,
  ];

  if (filters?.status) {
    conditions.push(eq(todoItems.status, filters.status));
  }

  if (filters?.priority) {
    conditions.push(eq(todoItems.priority, filters.priority as "low" | "medium" | "high" | "urgent"));
  }

  if (filters?.ownerUserId) {
    const ownerIds = Array.isArray(filters.ownerUserId)
      ? filters.ownerUserId
      : filters.ownerUserId.includes(",")
        ? filters.ownerUserId.split(",").map((id) => id.trim()).filter(Boolean)
        : [filters.ownerUserId];
    if (ownerIds.length === 1) {
      const ownerId = ownerIds[0];
      if (ownerId) {
        conditions.push(eq(todoItems.ownerUserId, ownerId));
      }
    } else if (ownerIds.length > 1) {
      conditions.push(inArray(todoItems.ownerUserId, ownerIds));
    }
  }

  if (filters?.projectId) {
    conditions.push(eq(todoItems.projectId, filters.projectId));
  }

  if (filters?.search) {
    conditions.push(
      or(
        ilike(todoItems.title, `%${filters.search}%`),
        ilike(todoItems.description, `%${filters.search}%`)
      )!
    );
  }

  const dueDateFilter = parseDueDateFilter(filters?.dueDate);
  if (dueDateFilter) {
    conditions.push(
      sql`${todoItems.dueDate} >= ${dueDateFilter.start} AND ${todoItems.dueDate} < ${dueDateFilter.end}`
    );
  }

  // Auto-hide done items completed more than 24h ago (unless showAllDone=true)
  if (!filters?.showAllDone) {
    conditions.push(
      sql`NOT (${todoItems.status} = 'done' AND ${todoItems.completedAt} IS NOT NULL AND ${todoItems.completedAt} < NOW() - INTERVAL '24 hours')`
    );
  }

  const whereClause = and(...conditions);

  // Sort: done items at the bottom, then by user's sortBy (default: createdAt DESC)
  const doneSortExpr = sql`CASE WHEN ${todoItems.status} = 'done' THEN 1 ELSE 0 END`;

  const sortColumnMap = {
    priority: todoItems.priority,
    createdAt: todoItems.createdAt,
    updatedAt: todoItems.updatedAt,
    dueDate: todoItems.dueDate,
  } as const;

  const sortByKey = filters?.sortBy ?? "createdAt";
  const sortColumn = sortColumnMap[sortByKey];
  const sortDirection = filters?.sortOrder ?? "desc";

  const secondaryOrderExpr = (() => {
    if (sortByKey === "priority") {
      // NULLS LAST for both ASC and DESC (items without priority go to the end)
      return sortDirection === "asc"
        ? sql`${sortColumn} ASC NULLS LAST`
        : sql`${sortColumn} DESC NULLS LAST`;
    }
    if (sortByKey === "dueDate") {
      // NULLS LAST for ASC (no date = end), NULLS FIRST for DESC
      return sortDirection === "asc"
        ? sql`${sortColumn} ASC NULLS LAST`
        : sql`${sortColumn} DESC NULLS FIRST`;
    }
    return sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn);
  })();

  const [itemsResult, countResult] = await Promise.all([
    db
      .select()
      .from(todoItems)
      .where(whereClause)
      .orderBy(asc(doneSortExpr), secondaryOrderExpr)
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(todoItems)
      .where(whereClause),
  ]);

  const itemsWithRelations = await Promise.all(
    itemsResult.map((item) => hydrateTodoItemRelations(item))
  );

  return {
    items: itemsWithRelations,
    total: countResult[0]?.count ?? 0,
  };
};

export const getTodoItemById = async (
  organizationId: string,
  id: string
): Promise<TodoItemWithRelations | null> => {
  const [item] = await db
    .select()
    .from(todoItems)
    .where(and(eq(todoItems.id, id), eq(todoItems.organizationId, organizationId)))
    .limit(1);

  if (!item) return null;
  return hydrateTodoItemRelations(item);
};

export const createTodoItem = async (
  organizationId: string,
  data: CreateTodoItemRequest,
  context: TodoItemEventContext = defaultEventContext
): Promise<TodoItemWithRelations> => {
  const status = data.status ?? "pending";
  const eventContext = resolveEventContext(context);

  if (data.ownerUserId) {
    await ensureOwnerBelongsToOrganization(organizationId, data.ownerUserId);
  }
  if (data.projectId) {
    await ensureProjectBelongsToOrganization(organizationId, data.projectId);
  }

  const [created] = await db
    .insert(todoItems)
    .values({
      organizationId,
      projectId: data.projectId ?? null,
      title: data.title.trim(),
      description: data.description ?? null,
      status,
      priority: data.priority ?? null,
      ownerUserId: data.ownerUserId ?? null,
      createdByUserId: eventContext.triggeredByUserId,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      completedAt: status === "done" ? new Date() : null,
      metadata: data.metadata ?? {},
    })
    .returning();

  if (!created) {
    throw new Error("FAILED_TO_CREATE_TODO_ITEM");
  }

  await insertEntityEvents([
    {
      entityType: "todo",
      entityId: created.id,
      eventType: "created",
      triggeredBy: eventContext.triggeredBy,
      triggeredByUserId: eventContext.triggeredByUserId,
      metadata: {
        title: created.title,
        status: created.status,
        projectId: created.projectId,
      },
    },
  ]);

  return getTodoItemById(organizationId, created.id) as Promise<TodoItemWithRelations>;
};

export const updateTodoItem = async (
  organizationId: string,
  id: string,
  data: UpdateTodoItemRequest,
  context: TodoItemEventContext = defaultEventContext
): Promise<TodoItemWithRelations | null> => {
  const eventContext = resolveEventContext(context);
  const [current] = await db
    .select()
    .from(todoItems)
    .where(and(eq(todoItems.id, id), eq(todoItems.organizationId, organizationId)))
    .limit(1);

  if (!current) return null;

  const nextStatus = data.status ?? current.status;

  if (data.ownerUserId) {
    await ensureOwnerBelongsToOrganization(organizationId, data.ownerUserId);
  }
  if (data.projectId !== undefined && data.projectId !== null) {
    await ensureProjectBelongsToOrganization(organizationId, data.projectId);
  }

  const updateValues: Partial<typeof todoItems.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (data.projectId !== undefined) updateValues.projectId = data.projectId;
  if (data.status !== undefined) updateValues.status = data.status;
  if (data.title !== undefined) updateValues.title = data.title.trim();
  if (data.description !== undefined) updateValues.description = data.description;
  if (data.priority !== undefined) updateValues.priority = data.priority;
  if (data.ownerUserId !== undefined) updateValues.ownerUserId = data.ownerUserId;
  if (data.dueDate !== undefined) {
    updateValues.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  }
  if (data.metadata !== undefined) updateValues.metadata = data.metadata;

  // completedAt transition logic
  if (nextStatus !== current.status) {
    if (nextStatus === "done") {
      updateValues.completedAt = new Date();
    } else if (current.status === "done") {
      updateValues.completedAt = null;
    }
  }

  const [updated] = await db
    .update(todoItems)
    .set(updateValues)
    .where(and(eq(todoItems.id, id), eq(todoItems.organizationId, organizationId)))
    .returning();

  if (!updated) return null;

  const trackedFields = [
    "projectId",
    "status",
    "title",
    "description",
    "priority",
    "ownerUserId",
    "dueDate",
    "metadata",
  ] as const;

  const fieldEvents: NewEntityEvent[] = [];
  trackedFields.forEach((fieldName) => {
    const previousValue = serializeEntityEventValue(current[fieldName]);
    const nextValue = serializeEntityEventValue(updated[fieldName]);
    if (previousValue === nextValue) return;

    fieldEvents.push({
      entityType: "todo",
      entityId: id,
      eventType: "updated",
      fieldName,
      oldValue: previousValue,
      newValue: nextValue,
      triggeredBy: eventContext.triggeredBy,
      triggeredByUserId: eventContext.triggeredByUserId,
    });
  });

  await insertEntityEvents(fieldEvents);

  return getTodoItemById(organizationId, id);
};

export const deleteTodoItem = async (
  organizationId: string,
  id: string
): Promise<boolean> => {
  const deleted = await db
    .delete(todoItems)
    .where(and(eq(todoItems.id, id), eq(todoItems.organizationId, organizationId)))
    .returning({ id: todoItems.id });

  return deleted.length > 0;
};

export const setTodoItemStatus = async (
  organizationId: string,
  id: string,
  status: TodoItemStatus,
  context: TodoItemEventContext = defaultEventContext
): Promise<TodoItemWithRelations | null> =>
  updateTodoItem(organizationId, id, { status }, context);

export const assignTodoItemOwner = async (
  organizationId: string,
  id: string,
  ownerUserId: string | null,
  context: TodoItemEventContext = defaultEventContext
): Promise<TodoItemWithRelations | null> =>
  updateTodoItem(organizationId, id, { ownerUserId }, context);

export const setTodoItemDueDate = async (
  organizationId: string,
  id: string,
  dueDate: string | null,
  context: TodoItemEventContext = defaultEventContext
): Promise<TodoItemWithRelations | null> =>
  updateTodoItem(organizationId, id, { dueDate }, context);

// ── Tags ────────────────────────────────────────────────────────────────

export const addTagToTodoItem = async (
  todoItemId: string,
  tagId: string
): Promise<void> => {
  await db
    .insert(todoItemTags)
    .values({ todoItemId, tagId })
    .onConflictDoNothing({
      target: [todoItemTags.todoItemId, todoItemTags.tagId],
    });
};

export const removeTagFromTodoItem = async (
  todoItemId: string,
  tagId: string
): Promise<boolean> => {
  const deleted = await db
    .delete(todoItemTags)
    .where(
      and(
        eq(todoItemTags.todoItemId, todoItemId),
        eq(todoItemTags.tagId, tagId)
      )
    )
    .returning({ id: todoItemTags.id });

  return deleted.length > 0;
};
