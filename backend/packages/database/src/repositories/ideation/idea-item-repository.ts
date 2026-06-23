import { db } from "../../client";
import {
  ideaItems,
  ideaItemComments,
  ideaItemFeedbackLinks,
  ideaItemWorkItemLinks,
  ideaItemEvents,
  ideaItemTags,
  feedbackItems,
  workItems,
  boardColumns,
  projects,
  tags,
  user,
  member,
} from "../../schema";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type {
  CreateIdeaItemRequest,
  IdeaItem,
  IdeaItemFeedbackLink,
  IdeaItemFilters,
  IdeaItemStatus,
  IdeaItemTraceabilityResult,
  IdeaItemType,
  IdeaItemWithRelations,
  IdeaItemEvent,
  IdeaItemEventContext,
  IdeaItemWorkItemLink,
  UpdateIdeaItemRequest,
} from "../../domain/types";
import type { PaginationParams } from "../../domain/types";
import type { NewIdeaItemEvent } from "../../schema/idea-item-events";

export const IDEA_STATUS_BY_TYPE: Record<IdeaItemType, IdeaItemStatus[]> = {
  idea: ["draft", "active", "to_review", "approved", "archived", "rejected"],
};

export const DEFAULT_STATUS_BY_TYPE: Record<IdeaItemType, IdeaItemStatus> = {
  idea: "active",
};

export const isStatusAllowedForType = (
  type: IdeaItemType,
  status: IdeaItemStatus
): boolean => {
  const allowedStatuses = IDEA_STATUS_BY_TYPE[type];
  if (!allowedStatuses) return false;
  return allowedStatuses.includes(status);
};

export const parseDueDateFilter = (raw?: string): { start: Date; end: Date } | null => {
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

const defaultIdeaItemEventContext: IdeaItemEventContext = {
  triggeredBy: "system",
};

export const resolveIdeaItemEventContext = (
  context: IdeaItemEventContext = defaultIdeaItemEventContext
): Required<Pick<IdeaItemEventContext, "triggeredBy">> & { triggeredByUserId: string | null } => ({
  triggeredBy: context.triggeredBy ?? (context.triggeredByUserId ? "user" : "system"),
  triggeredByUserId: context.triggeredByUserId ?? null,
});

export const serializeIdeaItemEventValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const insertIdeaItemEvents = async (events: NewIdeaItemEvent[]): Promise<void> => {
  if (events.length === 0) return;
  await db.insert(ideaItemEvents).values(events);
};

const ensureFeedbackBelongsToOrganization = async (
  _organizationId: string,
  feedbackItemId: string
): Promise<void> => {
  // Feedback is no longer project-scoped, so we just verify the item exists
  const [row] = await db
    .select({ id: feedbackItems.id })
    .from(feedbackItems)
    .where(eq(feedbackItems.id, feedbackItemId))
    .limit(1);

  if (!row) {
    throw new Error("FEEDBACK_NOT_FOUND");
  }
};

const ensureWorkItemBelongsToOrganization = async (
  organizationId: string,
  workItemId: string
): Promise<void> => {
  const [row] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(
      and(eq(workItems.id, workItemId), eq(projects.organizationId, organizationId))
    )
    .limit(1);

  if (!row) {
    throw new Error("WORK_ITEM_NOT_FOUND");
  }
};

const hydrateIdeaItemRelations = async (
  item: IdeaItem,
  includeTraceability: boolean
): Promise<IdeaItemWithRelations> => {
  const [ownerRow, createdByRow, projectRow, commentCountResult, tagsResult, lastCommentResult] = await Promise.all([
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
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ideaItemComments)
      .where(eq(ideaItemComments.ideaItemId, item.id)),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(ideaItemTags)
      .innerJoin(tags, eq(ideaItemTags.tagId, tags.id))
      .where(eq(ideaItemTags.ideaItemId, item.id)),
    db
      .select({
        userName: user.name,
        userImage: user.image,
        createdAt: ideaItemComments.createdAt,
      })
      .from(ideaItemComments)
      .innerJoin(user, eq(ideaItemComments.userId, user.id))
      .where(eq(ideaItemComments.ideaItemId, item.id))
      .orderBy(desc(ideaItemComments.createdAt))
      .limit(1),
  ]);

  const commentCount = commentCountResult[0]?.count ?? 0;
  const lastComment = lastCommentResult[0] ?? null;

  if (!includeTraceability) {
    return {
      ...item,
      owner: ownerRow[0] ?? null,
      createdBy: createdByRow[0] ?? null,
      projectName: projectRow[0]?.name ?? null,
      commentCount,
      lastComment,
      tags: tagsResult,
      feedbackLinks: [],
      workItemLinks: [],
    };
  }

  const [feedbackLinks, workItemLinks] = await Promise.all([
    db
      .select({
        id: ideaItemFeedbackLinks.id,
        feedbackItemId: ideaItemFeedbackLinks.feedbackItemId,
        title: feedbackItems.title,
        status: feedbackItems.status,
        category: feedbackItems.category,
        createdAt: feedbackItems.createdAt,
      })
      .from(ideaItemFeedbackLinks)
      .innerJoin(feedbackItems, eq(ideaItemFeedbackLinks.feedbackItemId, feedbackItems.id))
      .where(eq(ideaItemFeedbackLinks.ideaItemId, item.id))
      .orderBy(desc(ideaItemFeedbackLinks.createdAt)),
    db
      .select({
        id: ideaItemWorkItemLinks.id,
        workItemId: ideaItemWorkItemLinks.workItemId,
        taskId: workItems.taskId,
        title: workItems.title,
        type: workItems.type,
        priority: workItems.priority,
        columnName: boardColumns.name,
        linkType: ideaItemWorkItemLinks.linkType,
        createdAt: ideaItemWorkItemLinks.createdAt,
      })
      .from(ideaItemWorkItemLinks)
      .innerJoin(workItems, eq(ideaItemWorkItemLinks.workItemId, workItems.id))
      .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
      .where(eq(ideaItemWorkItemLinks.ideaItemId, item.id))
      .orderBy(desc(ideaItemWorkItemLinks.createdAt)),
  ]);

  return {
    ...item,
    owner: ownerRow[0] ?? null,
    createdBy: createdByRow[0] ?? null,
    projectName: projectRow[0]?.name ?? null,
    commentCount,
    lastComment,
    tags: tagsResult,
    feedbackLinks: feedbackLinks.map((row) => ({
      id: row.id,
      feedbackItemId: row.feedbackItemId,
      title: row.title,
      status: row.status,
      category: row.category,
      createdAt: row.createdAt,
    })),
    workItemLinks: workItemLinks.map((row) => ({
      id: row.id,
      workItemId: row.workItemId,
      taskId: row.taskId,
      title: row.title,
      type: row.type,
      priority: row.priority,
      columnName: row.columnName ?? "",
      linkType: row.linkType,
      createdAt: row.createdAt,
    })),
  };
};

export interface IdeaItemEventFilters {
  eventType?: string;
}

export const getIdeaItems = async (
  organizationId: string,
  pagination: PaginationParams,
  filters?: IdeaItemFilters
): Promise<{ items: IdeaItemWithRelations[]; total: number }> => {
  const conditions = [
    eq(ideaItems.organizationId, organizationId),
    sql`(${ideaItems.projectId} IS NULL OR ${ideaItems.projectId} IN (SELECT id FROM projects WHERE organization_id = ${organizationId} AND status != 'archived'))`,
  ];

  if (filters?.type) {
    conditions.push(eq(ideaItems.type, filters.type));
  }

  if (filters?.status) {
    conditions.push(eq(ideaItems.status, filters.status));
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
        conditions.push(eq(ideaItems.ownerUserId, ownerId));
      }
    } else if (ownerIds.length > 1) {
      conditions.push(inArray(ideaItems.ownerUserId, ownerIds));
    }
  }

  if (filters?.projectId) {
    conditions.push(eq(ideaItems.projectId, filters.projectId));
  }

  if (filters?.search) {
    conditions.push(
      or(
        ilike(ideaItems.title, `%${filters.search}%`),
        ilike(ideaItems.description, `%${filters.search}%`)
      )!
    );
  }

  if (filters?.discussed !== undefined) {
    conditions.push(eq(ideaItems.discussed, filters.discussed));
  }

  if (filters?.mentionedUserId) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM comment_mentions cm
        WHERE cm.idea_item_id = ${ideaItems.id}
          AND cm.mentioned_user_id = ${filters.mentionedUserId}
      )`
    );
  }

  const tagIds = (() => {
    if (!filters?.tagIds) return [];
    if (Array.isArray(filters.tagIds)) {
      return filters.tagIds.map((id) => id.trim()).filter(Boolean);
    }
    return filters.tagIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  })();

  if (tagIds.length > 0) {
    const tagSqlList = sql.join(tagIds.map((id) => sql`${id}`), sql`, `);
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM idea_item_tags
        WHERE idea_item_tags.idea_item_id = ${ideaItems.id}
          AND idea_item_tags.tag_id IN (${tagSqlList})
      )`
    );
  }

  const dueDateFilter = parseDueDateFilter(filters?.dueDate);
  if (dueDateFilter) {
    conditions.push(
      sql`${ideaItems.dueDate} >= ${dueDateFilter.start} AND ${ideaItems.dueDate} < ${dueDateFilter.end}`
    );
  }

  // Auto-hide done items completed more than 24h ago (unless showAllDone=true)
  if (!filters?.showAllDone) {
    conditions.push(
      sql`NOT (${ideaItems.status} = 'done' AND ${ideaItems.completedAt} IS NOT NULL AND ${ideaItems.completedAt} < NOW() - INTERVAL '24 hours')`
    );
  }

  const whereClause = and(...conditions);

  // Sort: done items at the bottom, then by user's sortBy (default: createdAt DESC)
  const doneSortExpr = sql`CASE WHEN ${ideaItems.status} = 'done' THEN 1 ELSE 0 END`;

  const sortColumnMap = {
    createdAt: ideaItems.createdAt,
    updatedAt: ideaItems.updatedAt,
    dueDate: ideaItems.dueDate,
  } as const;

  const sortByKey = filters?.sortBy ?? "createdAt";
  const sortColumn = sortColumnMap[sortByKey];
  const sortDirection = filters?.sortOrder ?? "desc";

  const secondaryOrderExpr = (() => {
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
      .from(ideaItems)
      .where(whereClause)
      .orderBy(asc(doneSortExpr), secondaryOrderExpr)
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ideaItems)
      .where(whereClause),
  ]);

  const itemsWithRelations = await Promise.all(
    itemsResult.map((item) => hydrateIdeaItemRelations(item as unknown as IdeaItem, false))
  );

  return {
    items: itemsWithRelations,
    total: countResult[0]?.count ?? 0,
  };
};

export const getIdeaItemById = async (
  organizationId: string,
  id: string
): Promise<IdeaItemWithRelations | null> => {
  const [item] = await db
    .select()
    .from(ideaItems)
    .where(and(eq(ideaItems.id, id), eq(ideaItems.organizationId, organizationId)))
    .limit(1);

  if (!item) return null;
  return hydrateIdeaItemRelations(item as unknown as IdeaItem, true);
};

export const getIdeaItemEventsByIdeaItemId = async (
  organizationId: string,
  ideaItemId: string,
  pagination: PaginationParams,
  filters?: IdeaItemEventFilters
): Promise<{ items: IdeaItemEvent[]; total: number }> => {
  const conditions = [
    eq(ideaItemEvents.ideaItemId, ideaItemId),
    eq(ideaItems.organizationId, organizationId),
  ];

  if (filters?.eventType) {
    conditions.push(eq(ideaItemEvents.eventType, filters.eventType));
  }

  const whereClause = and(...conditions);

  const [itemsResult, countResult] = await Promise.all([
    db
      .select({
        id: ideaItemEvents.id,
        ideaItemId: ideaItemEvents.ideaItemId,
        eventType: ideaItemEvents.eventType,
        fieldName: ideaItemEvents.fieldName,
        oldValue: ideaItemEvents.oldValue,
        newValue: ideaItemEvents.newValue,
        triggeredBy: ideaItemEvents.triggeredBy,
        triggeredByUserId: ideaItemEvents.triggeredByUserId,
        metadata: ideaItemEvents.metadata,
        createdAt: ideaItemEvents.createdAt,
        triggeredByUserName: user.name,
        triggeredByUserImage: user.image,
        triggeredByUserEmail: user.email,
      })
      .from(ideaItemEvents)
      .innerJoin(ideaItems, eq(ideaItemEvents.ideaItemId, ideaItems.id))
      .leftJoin(user, eq(ideaItemEvents.triggeredByUserId, user.id))
      .where(whereClause)
      .orderBy(desc(ideaItemEvents.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ideaItemEvents)
      .innerJoin(ideaItems, eq(ideaItemEvents.ideaItemId, ideaItems.id))
      .where(whereClause),
  ]);

  return {
    items: itemsResult as IdeaItemEvent[],
    total: countResult[0]?.count ?? 0,
  };
};

export const createIdeaItem = async (
  organizationId: string,
  data: CreateIdeaItemRequest,
  context: IdeaItemEventContext = defaultIdeaItemEventContext
): Promise<IdeaItemWithRelations> => {
  const type = data.type;
  const defaultStatus = DEFAULT_STATUS_BY_TYPE[type];
  if (!defaultStatus && !data.status) {
    throw new Error("INVALID_IDEA_ITEM_TYPE");
  }
  const status = data.status ?? defaultStatus;
  const eventContext = resolveIdeaItemEventContext(context);

  if (!isStatusAllowedForType(type, status)) {
    throw new Error("INVALID_STATUS_FOR_TYPE");
  }

  if (data.ownerUserId) {
    await ensureOwnerBelongsToOrganization(organizationId, data.ownerUserId);
  }
  if (data.projectId) {
    await ensureProjectBelongsToOrganization(organizationId, data.projectId);
  }

  const [created] = await db
    .insert(ideaItems)
    .values({
      organizationId,
      projectId: data.projectId ?? null,
      type,
      status,
      title: data.title.trim(),
      description: data.description ?? null,
      ownerUserId: data.ownerUserId ?? null,
      createdByUserId: eventContext.triggeredByUserId,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      metadata: data.metadata ?? {},
      completedAt: null,
    })
    .returning();

  if (!created) {
    throw new Error("FAILED_TO_CREATE_IDEA_ITEM");
  }

  await insertIdeaItemEvents([
    {
      ideaItemId: created.id,
      eventType: "created",
      triggeredBy: eventContext.triggeredBy,
      triggeredByUserId: eventContext.triggeredByUserId,
      metadata: {
        title: created.title,
        type: created.type,
        status: created.status,
        projectId: created.projectId,
      },
    },
  ]);

  return getIdeaItemById(organizationId, created.id) as Promise<IdeaItemWithRelations>;
};

export const updateIdeaItem = async (
  organizationId: string,
  id: string,
  data: UpdateIdeaItemRequest,
  context: IdeaItemEventContext = defaultIdeaItemEventContext
): Promise<IdeaItemWithRelations | null> => {
  const eventContext = resolveIdeaItemEventContext(context);
  const [current] = await db
    .select()
    .from(ideaItems)
    .where(and(eq(ideaItems.id, id), eq(ideaItems.organizationId, organizationId)))
    .limit(1);

  if (!current) return null;

  const nextType = (data.type ?? current.type) as IdeaItemType;
  const explicitStatus = data.status;
  const currentStatus = current.status as IdeaItemStatus;
  const nextStatus =
    explicitStatus ??
    (data.type && !isStatusAllowedForType(data.type, currentStatus)
      ? DEFAULT_STATUS_BY_TYPE[data.type]
      : currentStatus);

  if (!isStatusAllowedForType(nextType, nextStatus)) {
    throw new Error("INVALID_STATUS_FOR_TYPE");
  }

  if (data.ownerUserId) {
    await ensureOwnerBelongsToOrganization(organizationId, data.ownerUserId);
  }
  if (data.projectId !== undefined && data.projectId !== null) {
    await ensureProjectBelongsToOrganization(organizationId, data.projectId);
  }

  const updateValues: Partial<typeof ideaItems.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (data.projectId !== undefined) updateValues.projectId = data.projectId;
  if (data.type !== undefined) updateValues.type = data.type;
  if (explicitStatus !== undefined || data.type !== undefined) {
    updateValues.status = nextStatus;
  }
  if (data.title !== undefined) updateValues.title = data.title.trim();
  if (data.description !== undefined) updateValues.description = data.description;
  if (data.ownerUserId !== undefined) updateValues.ownerUserId = data.ownerUserId;
  if (data.dueDate !== undefined) {
    updateValues.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  }
  if (data.metadata !== undefined) updateValues.metadata = data.metadata;
  if (data.discussed !== undefined) updateValues.discussed = data.discussed;

  // completedAt transition logic (legacy: handles existing "done" items from former todo type)
  if ((nextStatus as string) !== current.status) {
    if ((nextStatus as string) === "done") {
      updateValues.completedAt = new Date();
    } else if (current.status === "done") {
      updateValues.completedAt = null;
    }
  }

  const [updated] = await db
    .update(ideaItems)
    .set(updateValues)
    .where(and(eq(ideaItems.id, id), eq(ideaItems.organizationId, organizationId)))
    .returning();

  if (!updated) return null;

  const trackedFields = [
    "projectId",
    "type",
    "status",
    "title",
    "description",
    "ownerUserId",
    "dueDate",
    "metadata",
    "discussed",
  ] as const;

  const fieldEvents: NewIdeaItemEvent[] = [];
  trackedFields.forEach((fieldName) => {
    const previousValue = serializeIdeaItemEventValue(current[fieldName]);
    const nextValue = serializeIdeaItemEventValue(updated[fieldName]);
    if (previousValue === nextValue) return;

    fieldEvents.push({
      ideaItemId: id,
      eventType: "updated",
      fieldName,
      oldValue: previousValue,
      newValue: nextValue,
      triggeredBy: eventContext.triggeredBy,
      triggeredByUserId: eventContext.triggeredByUserId,
    });
  });

  await insertIdeaItemEvents(fieldEvents);

  return getIdeaItemById(organizationId, id);
};

export const deleteIdeaItem = async (
  organizationId: string,
  id: string
): Promise<boolean> => {
  const deleted = await db
    .delete(ideaItems)
    .where(and(eq(ideaItems.id, id), eq(ideaItems.organizationId, organizationId)))
    .returning({ id: ideaItems.id });

  return deleted.length > 0;
};

export const setIdeaItemStatus = async (
  organizationId: string,
  id: string,
  status: IdeaItemStatus,
  context: IdeaItemEventContext = defaultIdeaItemEventContext
): Promise<IdeaItemWithRelations | null> =>
  updateIdeaItem(organizationId, id, { status }, context);

export const assignIdeaItemOwner = async (
  organizationId: string,
  id: string,
  ownerUserId: string | null,
  context: IdeaItemEventContext = defaultIdeaItemEventContext
): Promise<IdeaItemWithRelations | null> =>
  updateIdeaItem(organizationId, id, { ownerUserId }, context);

export const setIdeaItemDueDate = async (
  organizationId: string,
  id: string,
  dueDate: string | null,
  context: IdeaItemEventContext = defaultIdeaItemEventContext
): Promise<IdeaItemWithRelations | null> =>
  updateIdeaItem(organizationId, id, { dueDate }, context);

export const toggleIdeaItemDiscussed = async (
  organizationId: string,
  id: string,
  discussed: boolean,
  context: IdeaItemEventContext = defaultIdeaItemEventContext
): Promise<IdeaItemWithRelations | null> => {
  const eventContext = resolveIdeaItemEventContext(context);
  const [current] = await db
    .select()
    .from(ideaItems)
    .where(and(eq(ideaItems.id, id), eq(ideaItems.organizationId, organizationId)))
    .limit(1);

  if (!current) return null;

  const [updated] = await db
    .update(ideaItems)
    .set({ discussed, updatedAt: new Date() })
    .where(and(eq(ideaItems.id, id), eq(ideaItems.organizationId, organizationId)))
    .returning();

  if (!updated) return null;

  await insertIdeaItemEvents([{
    ideaItemId: id,
    eventType: "updated",
    fieldName: "discussed",
    oldValue: String(current.discussed),
    newValue: String(discussed),
    triggeredBy: eventContext.triggeredBy,
    triggeredByUserId: eventContext.triggeredByUserId,
  }]);

  return getIdeaItemById(organizationId, id);
};

export const linkFeedbackToIdeaItem = async (
  organizationId: string,
  ideaItemId: string,
  feedbackItemId: string,
  metadata: Record<string, unknown> = {},
  context: IdeaItemEventContext = defaultIdeaItemEventContext
): Promise<IdeaItemFeedbackLink> => {
  const eventContext = resolveIdeaItemEventContext(context);
  const ideaItem = await getIdeaItemById(organizationId, ideaItemId);
  if (!ideaItem) throw new Error("IDEA_ITEM_NOT_FOUND");

  await ensureFeedbackBelongsToOrganization(organizationId, feedbackItemId);

  const [inserted] = await db
    .insert(ideaItemFeedbackLinks)
    .values({
      ideaItemId,
      feedbackItemId,
      metadata,
    })
    .onConflictDoNothing({
      target: [ideaItemFeedbackLinks.ideaItemId, ideaItemFeedbackLinks.feedbackItemId],
    })
    .returning();

  if (inserted) {
    await insertIdeaItemEvents([
      {
        ideaItemId,
        eventType: "feedback_linked",
        triggeredBy: eventContext.triggeredBy,
        triggeredByUserId: eventContext.triggeredByUserId,
        metadata: {
          feedbackItemId,
        },
      },
    ]);
    return inserted;
  }

  const [existing] = await db
    .select()
    .from(ideaItemFeedbackLinks)
    .where(
      and(
        eq(ideaItemFeedbackLinks.ideaItemId, ideaItemId),
        eq(ideaItemFeedbackLinks.feedbackItemId, feedbackItemId)
      )
    )
    .limit(1);

  if (!existing) throw new Error("FAILED_TO_LINK_FEEDBACK");
  return existing;
};

export const unlinkFeedbackFromIdeaItem = async (
  organizationId: string,
  ideaItemId: string,
  feedbackItemId: string,
  context: IdeaItemEventContext = defaultIdeaItemEventContext
): Promise<boolean> => {
  const eventContext = resolveIdeaItemEventContext(context);
  const ideaItem = await getIdeaItemById(organizationId, ideaItemId);
  if (!ideaItem) throw new Error("IDEA_ITEM_NOT_FOUND");

  const deleted = await db
    .delete(ideaItemFeedbackLinks)
    .where(
      and(
        eq(ideaItemFeedbackLinks.ideaItemId, ideaItemId),
        eq(ideaItemFeedbackLinks.feedbackItemId, feedbackItemId)
      )
    )
    .returning({ id: ideaItemFeedbackLinks.id });

  const wasDeleted = deleted.length > 0;
  if (wasDeleted) {
    await insertIdeaItemEvents([
      {
        ideaItemId,
        eventType: "feedback_unlinked",
        triggeredBy: eventContext.triggeredBy,
        triggeredByUserId: eventContext.triggeredByUserId,
        metadata: {
          feedbackItemId,
        },
      },
    ]);
  }

  return wasDeleted;
};

export const linkWorkItemToIdeaItem = async (
  organizationId: string,
  ideaItemId: string,
  workItemId: string,
  linkType: IdeaItemWorkItemLink["linkType"] = "related_to",
  createdBy: string | null = null,
  metadata: Record<string, unknown> = {},
  context: IdeaItemEventContext = defaultIdeaItemEventContext
): Promise<IdeaItemWorkItemLink> => {
  const eventContext = resolveIdeaItemEventContext({
    ...context,
    triggeredByUserId: context.triggeredByUserId ?? createdBy,
    triggeredBy: context.triggeredBy ?? (createdBy ? "user" : undefined),
  });
  const ideaItem = await getIdeaItemById(organizationId, ideaItemId);
  if (!ideaItem) throw new Error("IDEA_ITEM_NOT_FOUND");

  await ensureWorkItemBelongsToOrganization(organizationId, workItemId);

  const [inserted] = await db
    .insert(ideaItemWorkItemLinks)
    .values({
      ideaItemId,
      workItemId,
      linkType,
      createdBy,
      metadata,
    })
    .onConflictDoNothing({
      target: [ideaItemWorkItemLinks.ideaItemId, ideaItemWorkItemLinks.workItemId],
    })
    .returning();

  if (inserted) {
    await insertIdeaItemEvents([
      {
        ideaItemId,
        eventType: "work_item_linked",
        triggeredBy: eventContext.triggeredBy,
        triggeredByUserId: eventContext.triggeredByUserId,
        metadata: {
          workItemId,
          linkType,
        },
      },
    ]);
    return inserted;
  }

  const [existing] = await db
    .select()
    .from(ideaItemWorkItemLinks)
    .where(
      and(
        eq(ideaItemWorkItemLinks.ideaItemId, ideaItemId),
        eq(ideaItemWorkItemLinks.workItemId, workItemId)
      )
    )
    .limit(1);

  if (!existing) throw new Error("FAILED_TO_LINK_WORK_ITEM");
  return existing;
};

export const getIdeaItemTraceability = async (
  organizationId: string,
  ideaItemId: string
): Promise<IdeaItemTraceabilityResult | null> => {
  const item = await getIdeaItemById(organizationId, ideaItemId);
  if (!item) return null;

  return {
    ideaItem: {
      id: item.id,
      organizationId: item.organizationId,
      projectId: item.projectId,
      type: item.type,
      status: item.status,
      title: item.title,
      description: item.description,
      ownerUserId: item.ownerUserId,
      createdByUserId: item.createdByUserId,
      dueDate: item.dueDate,
      metadata: item.metadata,
      discussed: item.discussed,
      completedAt: item.completedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    },
    feedbackLinks: item.feedbackLinks,
    workItemLinks: item.workItemLinks,
  };
};

export const addTagToIdeaItem = async (
  ideaItemId: string,
  tagId: string
): Promise<void> => {
  await db
    .insert(ideaItemTags)
    .values({ ideaItemId, tagId })
    .onConflictDoNothing({
      target: [ideaItemTags.ideaItemId, ideaItemTags.tagId],
    });
};

export const removeTagFromIdeaItem = async (
  ideaItemId: string,
  tagId: string
): Promise<boolean> => {
  const deleted = await db
    .delete(ideaItemTags)
    .where(
      and(
        eq(ideaItemTags.ideaItemId, ideaItemId),
        eq(ideaItemTags.tagId, tagId)
      )
    )
    .returning({ id: ideaItemTags.id });

  return deleted.length > 0;
};

export const getTagsByIdeaItem = async (
  ideaItemId: string
): Promise<{ id: string; name: string; color: string }[]> => {
  return db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(ideaItemTags)
    .innerJoin(tags, eq(ideaItemTags.tagId, tags.id))
    .where(eq(ideaItemTags.ideaItemId, ideaItemId));
};
