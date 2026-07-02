import { db } from "../../client";
import {
  seeds,
  seedTags,
  seedFeedbackLinks,
  seedWorkItemLinks,
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
  CreateSeedInput,
  Seed,
  SeedEventContext,
  SeedFilters,
  SeedStatus,
  SeedStatusGroup,
  SeedWithRelations,
  UpdateSeedInput,
} from "../../domain/types";
import type { PaginationParams } from "../../domain/types";
import type { NewEntityEvent } from "../../schema/entity-events";
import {
  createEntityEvents,
  serializeEntityEventValue,
  getEntityCommentCount,
  getLastEntityComment,
  getEntityEvents as getEntityEventsGeneric,
} from "..";
import type { LastCommentInfo, EntityEventWithUser, EntityEventFilters } from "..";

// ── Constants ─────────────────────────────────────────────────────────────

const SEED_ENTITY_TYPE = "seed" as const;

const VALID_SEED_STATUSES: SeedStatus[] = [
  "draft",
  "active",
  "to_review",
  "approved",
  "archived",
  "rejected",
];

const SEED_STATUS_GROUPS: Record<SeedStatusGroup, SeedStatus[]> = {
  active: ["draft", "active", "to_review"],
  finished: ["approved", "archived", "rejected"],
};

// ── Helpers ───────────────────────────────────────────────────────────────

const defaultEventContext: SeedEventContext = {
  triggeredBy: "system",
};

const resolveEventContext = (
  context: SeedEventContext = defaultEventContext
): Required<Pick<SeedEventContext, "triggeredBy">> & { triggeredByUserId: string | null } => ({
  triggeredBy: context.triggeredBy ?? (context.triggeredByUserId ? "user" : "system"),
  triggeredByUserId: context.triggeredByUserId ?? null,
});

const insertEntityEvents = async (events: NewEntityEvent[]): Promise<void> => {
  await createEntityEvents(events);
};

const calculateMaturityLevel = (data: {
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
}): number => {
  const hasDescription = !!data.description && data.description.length > 50;
  const meta = data.metadata ?? {};
  const hasDod = typeof meta.definitionOfDone === "string" && meta.definitionOfDone.length > 0;
  const hasProposal = typeof meta.implementationProposal === "string" && meta.implementationProposal.length > 0;

  if (hasDescription && (hasDod || hasProposal)) return 3;
  if (hasDescription) return 2;
  return 1;
};

const ensureOwnerBelongsToWorkspace = async (
  workspaceId: string,
  ownerUserId: string
): Promise<void> => {
  const [ownerMembership] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.workspaceId, workspaceId),
        eq(member.userId, ownerUserId)
      )
    )
    .limit(1);

  if (!ownerMembership) {
    throw new Error("OWNER_NOT_MEMBER");
  }
};

const ensureProjectBelongsToWorkspace = async (
  workspaceId: string,
  projectId: string
): Promise<void> => {
  const [projectRow] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId)
      )
    )
    .limit(1);

  if (!projectRow) {
    throw new Error("PROJECT_NOT_IN_WORKSPACE");
  }
};

const ensureFeedbackBelongsToWorkspace = async (
  _workspaceId: string,
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

const ensureWorkItemBelongsToWorkspace = async (
  workspaceId: string,
  workItemId: string
): Promise<void> => {
  const [row] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(
      and(eq(workItems.id, workItemId), eq(projects.workspaceId, workspaceId))
    )
    .limit(1);

  if (!row) {
    throw new Error("WORK_ITEM_NOT_FOUND");
  }
};

type SeedRow = typeof seeds.$inferSelect;

export const hydrateSeedRelations = async (
  item: SeedRow,
  includeTraceability: boolean
): Promise<SeedWithRelations> => {
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
    getEntityCommentCount(SEED_ENTITY_TYPE, item.id),
    getLastEntityComment(SEED_ENTITY_TYPE, item.id),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(seedTags)
      .innerJoin(tags, eq(seedTags.tagId, tags.id))
      .where(eq(seedTags.seedId, item.id)),
  ]);

  const seedBase: Seed = {
    id: item.id,
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    status: item.status as SeedStatus,
    title: item.title,
    description: item.description,
    source: item.source as Seed["source"],
    priority: item.priority as Seed["priority"],
    selectedForIdeation: item.selectedForIdeation,
    ownerUserId: item.ownerUserId,
    createdByUserId: item.createdByUserId,
    metadata: (item.metadata as Record<string, unknown>) ?? {},
    maturityLevel: item.maturityLevel,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };

  if (!includeTraceability) {
    return {
      ...seedBase,
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

  const [feedbackLinksResult, workItemLinksResult] = await Promise.all([
    db
      .select({
        id: seedFeedbackLinks.id,
        feedbackItemId: seedFeedbackLinks.feedbackItemId,
        title: feedbackItems.title,
        status: feedbackItems.status,
        category: feedbackItems.category,
        createdAt: feedbackItems.createdAt,
      })
      .from(seedFeedbackLinks)
      .innerJoin(feedbackItems, eq(seedFeedbackLinks.feedbackItemId, feedbackItems.id))
      .where(eq(seedFeedbackLinks.seedId, item.id))
      .orderBy(desc(seedFeedbackLinks.createdAt)),
    db
      .select({
        id: seedWorkItemLinks.id,
        workItemId: seedWorkItemLinks.workItemId,
        taskId: workItems.taskId,
        title: workItems.title,
        type: workItems.type,
        priority: workItems.priority,
        columnName: boardColumns.name,
        linkType: seedWorkItemLinks.linkType,
        createdAt: seedWorkItemLinks.createdAt,
      })
      .from(seedWorkItemLinks)
      .innerJoin(workItems, eq(seedWorkItemLinks.workItemId, workItems.id))
      .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
      .where(eq(seedWorkItemLinks.seedId, item.id))
      .orderBy(desc(seedWorkItemLinks.createdAt)),
  ]);

  return {
    ...seedBase,
    owner: ownerRow[0] ?? null,
    createdBy: createdByRow[0] ?? null,
    projectName: projectRow[0]?.name ?? null,
    commentCount,
    lastComment,
    tags: tagsResult,
    feedbackLinks: feedbackLinksResult.map((row) => ({
      id: row.id,
      feedbackItemId: row.feedbackItemId,
      title: row.title,
      status: row.status,
      category: row.category,
      createdAt: row.createdAt,
    })),
    workItemLinks: workItemLinksResult.map((row) => ({
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

// ── CRUD ──────────────────────────────────────────────────────────────────

export const getSeeds = async (
  workspaceId: string,
  pagination: PaginationParams,
  filters?: SeedFilters
): Promise<{ items: SeedWithRelations[]; total: number }> => {
  const conditions = [
    eq(seeds.workspaceId, workspaceId),
    sql`(${seeds.projectId} IS NULL OR ${seeds.projectId} IN (SELECT id FROM projects WHERE workspace_id = ${workspaceId} AND status != 'archived'))`,
  ];

  if (filters?.statusGroup) {
    const groupStatuses = SEED_STATUS_GROUPS[filters.statusGroup];
    if (groupStatuses) {
      conditions.push(inArray(seeds.status, groupStatuses));
    }
  } else if (filters?.statuses && filters.statuses.length > 0) {
    conditions.push(inArray(seeds.status, filters.statuses));
  } else if (filters?.status) {
    conditions.push(eq(seeds.status, filters.status));
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
        conditions.push(eq(seeds.ownerUserId, ownerId));
      }
    } else if (ownerIds.length > 1) {
      conditions.push(inArray(seeds.ownerUserId, ownerIds));
    }
  }

  if (filters?.projectId) {
    conditions.push(eq(seeds.projectId, filters.projectId));
  }

  if (filters?.search) {
    conditions.push(
      or(
        ilike(seeds.title, `%${filters.search}%`),
        ilike(seeds.description, `%${filters.search}%`)
      )!
    );
  }

  if (filters?.selectedForIdeation !== undefined) {
    conditions.push(eq(seeds.selectedForIdeation, filters.selectedForIdeation));
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
        SELECT 1 FROM seed_tags
        WHERE seed_tags.seed_id = ${seeds.id}
          AND seed_tags.tag_id IN (${tagSqlList})
      )`
    );
  }

  const whereClause = and(...conditions);

  const sortColumnMap = {
    priority: seeds.priority,
    createdAt: seeds.createdAt,
    updatedAt: seeds.updatedAt,
  } as const;

  const sortByKey = filters?.sortBy ?? "createdAt";
  const sortColumn = sortColumnMap[sortByKey];
  const sortDirection = filters?.sortOrder ?? "desc";

  const orderExpr = (() => {
    if (sortByKey === "priority") {
      // NULLS LAST for both ASC and DESC (items without priority go to the end)
      return sortDirection === "asc"
        ? sql`${sortColumn} ASC NULLS LAST`
        : sql`${sortColumn} DESC NULLS LAST`;
    }
    return sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn);
  })();

  const [itemsResult, countResult] = await Promise.all([
    db
      .select()
      .from(seeds)
      .where(whereClause)
      .orderBy(orderExpr)
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(seeds)
      .where(whereClause),
  ]);

  const itemsWithRelations = await Promise.all(
    itemsResult.map((item) => hydrateSeedRelations(item, false))
  );

  return {
    items: itemsWithRelations,
    total: countResult[0]?.count ?? 0,
  };
};

export const getSeedById = async (
  workspaceId: string,
  id: string
): Promise<SeedWithRelations | null> => {
  const [item] = await db
    .select()
    .from(seeds)
    .where(and(eq(seeds.id, id), eq(seeds.workspaceId, workspaceId)))
    .limit(1);

  if (!item) return null;
  return hydrateSeedRelations(item, true);
};

export const createSeed = async (
  workspaceId: string,
  data: CreateSeedInput,
  context: SeedEventContext = defaultEventContext
): Promise<SeedWithRelations> => {
  const eventContext = resolveEventContext(context);

  if (data.ownerUserId) {
    await ensureOwnerBelongsToWorkspace(workspaceId, data.ownerUserId);
  }
  if (data.projectId) {
    await ensureProjectBelongsToWorkspace(workspaceId, data.projectId);
  }

  const [created] = await db
    .insert(seeds)
    .values({
      workspaceId,
      projectId: data.projectId ?? null,
      title: data.title.trim(),
      description: data.description ?? null,
      source: data.source ?? "manual",
      priority: data.priority ?? null,
      selectedForIdeation: data.selectedForIdeation ?? false,
      ownerUserId: data.ownerUserId ?? null,
      createdByUserId: eventContext.triggeredByUserId,
      metadata: data.metadata ?? {},
      maturityLevel: calculateMaturityLevel({
        title: data.title.trim(),
        description: data.description ?? null,
        metadata: data.metadata ?? {},
      }),
    })
    .returning();

  if (!created) {
    throw new Error("FAILED_TO_CREATE_SEED");
  }

  await insertEntityEvents([
    {
      entityType: SEED_ENTITY_TYPE,
      entityId: created.id,
      eventType: "created",
      triggeredBy: eventContext.triggeredBy,
      triggeredByUserId: eventContext.triggeredByUserId,
      metadata: {
        title: created.title,
        source: created.source,
        status: created.status,
        projectId: created.projectId,
      },
    },
  ]);

  return getSeedById(workspaceId, created.id) as Promise<SeedWithRelations>;
};

export const updateSeed = async (
  workspaceId: string,
  id: string,
  data: UpdateSeedInput,
  context: SeedEventContext = defaultEventContext
): Promise<SeedWithRelations | null> => {
  const eventContext = resolveEventContext(context);
  const [current] = await db
    .select()
    .from(seeds)
    .where(and(eq(seeds.id, id), eq(seeds.workspaceId, workspaceId)))
    .limit(1);

  if (!current) return null;

  if (data.status && !VALID_SEED_STATUSES.includes(data.status)) {
    throw new Error("INVALID_SEED_STATUS");
  }

  if (data.ownerUserId) {
    await ensureOwnerBelongsToWorkspace(workspaceId, data.ownerUserId);
  }
  if (data.projectId !== undefined && data.projectId !== null) {
    await ensureProjectBelongsToWorkspace(workspaceId, data.projectId);
  }

  const updateValues: Partial<typeof seeds.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (data.projectId !== undefined) updateValues.projectId = data.projectId;
  if (data.status !== undefined) updateValues.status = data.status;
  if (data.title !== undefined) updateValues.title = data.title.trim();
  if (data.description !== undefined) updateValues.description = data.description;
  if (data.source !== undefined) updateValues.source = data.source;
  if (data.priority !== undefined) updateValues.priority = data.priority;
  if (data.ownerUserId !== undefined) updateValues.ownerUserId = data.ownerUserId;
  if (data.selectedForIdeation !== undefined) updateValues.selectedForIdeation = data.selectedForIdeation;
  if (data.metadata !== undefined) updateValues.metadata = data.metadata;

  // Recalculate maturity level based on merged state
  const mergedTitle = (data.title !== undefined ? data.title.trim() : current.title);
  const mergedDescription = (data.description !== undefined ? data.description : current.description);
  const mergedMetadata = (data.metadata !== undefined ? data.metadata : (current.metadata as Record<string, unknown>) ?? {});
  updateValues.maturityLevel = calculateMaturityLevel({
    title: mergedTitle,
    description: mergedDescription,
    metadata: mergedMetadata,
  });

  const [updated] = await db
    .update(seeds)
    .set(updateValues)
    .where(and(eq(seeds.id, id), eq(seeds.workspaceId, workspaceId)))
    .returning();

  if (!updated) return null;

  const trackedFields = [
    "projectId",
    "status",
    "title",
    "description",
    "source",
    "priority",
    "ownerUserId",
    "selectedForIdeation",
    "metadata",
    "maturityLevel",
  ] as const;

  const fieldEvents: NewEntityEvent[] = [];
  trackedFields.forEach((fieldName) => {
    const previousValue = serializeEntityEventValue(current[fieldName]);
    const nextValue = serializeEntityEventValue(updated[fieldName]);
    if (previousValue === nextValue) return;

    fieldEvents.push({
      entityType: SEED_ENTITY_TYPE,
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

  return getSeedById(workspaceId, id);
};

export const deleteSeed = async (
  workspaceId: string,
  id: string
): Promise<boolean> => {
  const deleted = await db
    .delete(seeds)
    .where(and(eq(seeds.id, id), eq(seeds.workspaceId, workspaceId)))
    .returning({ id: seeds.id });

  return deleted.length > 0;
};

// ── Status & Assignment ───────────────────────────────────────────────────

export const setSeedStatus = async (
  workspaceId: string,
  id: string,
  status: SeedStatus,
  context: SeedEventContext = defaultEventContext
): Promise<SeedWithRelations | null> =>
  updateSeed(workspaceId, id, { status }, context);

export const assignSeedOwner = async (
  workspaceId: string,
  id: string,
  ownerUserId: string | null,
  context: SeedEventContext = defaultEventContext
): Promise<SeedWithRelations | null> =>
  updateSeed(workspaceId, id, { ownerUserId }, context);

// ── Selected for Ideation ─────────────────────────────────────────────────

export const toggleSeedSelectedForIdeation = async (
  workspaceId: string,
  id: string,
  selected: boolean
): Promise<SeedWithRelations | null> => {
  const [current] = await db
    .select()
    .from(seeds)
    .where(and(eq(seeds.id, id), eq(seeds.workspaceId, workspaceId)))
    .limit(1);

  if (!current) return null;

  await db
    .update(seeds)
    .set({ selectedForIdeation: selected, updatedAt: new Date() })
    .where(and(eq(seeds.id, id), eq(seeds.workspaceId, workspaceId)));

  return getSeedById(workspaceId, id);
};

export const bulkSelectSeedsForIdeation = async (
  workspaceId: string,
  ids: string[],
  selected: boolean
): Promise<number> => {
  if (ids.length === 0) return 0;

  const result = await db
    .update(seeds)
    .set({
      selectedForIdeation: selected,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(seeds.workspaceId, workspaceId),
        inArray(seeds.id, ids)
      )
    )
    .returning({ id: seeds.id });

  return result.length;
};

/**
 * Mark seeds as `to_review` and clear `selectedForIdeation` flag.
 * Used when a planning session completes to mark the seeds as ready for review.
 */
export const markSeedsAsToReview = async (
  workspaceId: string,
  ids: string[]
): Promise<number> => {
  if (ids.length === 0) return 0;

  const result = await db
    .update(seeds)
    .set({
      status: "to_review",
      selectedForIdeation: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(seeds.workspaceId, workspaceId),
        inArray(seeds.id, ids)
      )
    )
    .returning({ id: seeds.id });

  return result.length;
};

export const getSelectedSeedsForIdeation = async (
  workspaceId: string,
  projectId?: string
): Promise<SeedWithRelations[]> => {
  const conditions = [
    eq(seeds.workspaceId, workspaceId),
    eq(seeds.selectedForIdeation, true),
    eq(seeds.status, "active"),
  ];

  if (projectId) {
    conditions.push(eq(seeds.projectId, projectId));
  }

  const results = await db
    .select()
    .from(seeds)
    .where(and(...conditions))
    .orderBy(asc(seeds.createdAt));

  return Promise.all(results.map((item) => hydrateSeedRelations(item, false)));
};

// ── Feedback Links ────────────────────────────────────────────────────────

export const linkFeedbackToSeed = async (
  workspaceId: string,
  seedId: string,
  feedbackItemId: string,
  context: SeedEventContext = defaultEventContext
): Promise<{ id: string; seedId: string; feedbackItemId: string; createdAt: Date }> => {
  const eventContext = resolveEventContext(context);
  const seed = await getSeedById(workspaceId, seedId);
  if (!seed) throw new Error("SEED_NOT_FOUND");

  await ensureFeedbackBelongsToWorkspace(workspaceId, feedbackItemId);

  const [inserted] = await db
    .insert(seedFeedbackLinks)
    .values({
      seedId,
      feedbackItemId,
    })
    .onConflictDoNothing({
      target: [seedFeedbackLinks.seedId, seedFeedbackLinks.feedbackItemId],
    })
    .returning();

  if (inserted) {
    await insertEntityEvents([
      {
        entityType: SEED_ENTITY_TYPE,
        entityId: seedId,
        eventType: "feedback_linked",
        triggeredBy: eventContext.triggeredBy,
        triggeredByUserId: eventContext.triggeredByUserId,
        metadata: { feedbackItemId },
      },
    ]);
    return inserted;
  }

  const [existing] = await db
    .select()
    .from(seedFeedbackLinks)
    .where(
      and(
        eq(seedFeedbackLinks.seedId, seedId),
        eq(seedFeedbackLinks.feedbackItemId, feedbackItemId)
      )
    )
    .limit(1);

  if (!existing) throw new Error("FAILED_TO_LINK_FEEDBACK");
  return existing;
};

export const unlinkFeedbackFromSeed = async (
  workspaceId: string,
  seedId: string,
  feedbackItemId: string,
  context: SeedEventContext = defaultEventContext
): Promise<boolean> => {
  const eventContext = resolveEventContext(context);
  const seed = await getSeedById(workspaceId, seedId);
  if (!seed) throw new Error("SEED_NOT_FOUND");

  const deleted = await db
    .delete(seedFeedbackLinks)
    .where(
      and(
        eq(seedFeedbackLinks.seedId, seedId),
        eq(seedFeedbackLinks.feedbackItemId, feedbackItemId)
      )
    )
    .returning({ id: seedFeedbackLinks.id });

  const wasDeleted = deleted.length > 0;
  if (wasDeleted) {
    await insertEntityEvents([
      {
        entityType: SEED_ENTITY_TYPE,
        entityId: seedId,
        eventType: "feedback_unlinked",
        triggeredBy: eventContext.triggeredBy,
        triggeredByUserId: eventContext.triggeredByUserId,
        metadata: { feedbackItemId },
      },
    ]);
  }

  return wasDeleted;
};

// ── Work Item Links ───────────────────────────────────────────────────────

export const linkWorkItemToSeed = async (
  workspaceId: string,
  seedId: string,
  workItemId: string,
  linkType: "promoted_to" | "related_to" = "related_to",
  createdBy: string | null = null,
  context: SeedEventContext = defaultEventContext
): Promise<{ id: string; seedId: string; workItemId: string; linkType: string; createdAt: Date }> => {
  const eventContext = resolveEventContext({
    ...context,
    triggeredByUserId: context.triggeredByUserId ?? createdBy,
    triggeredBy: context.triggeredBy ?? (createdBy ? "user" : undefined),
  });
  const seed = await getSeedById(workspaceId, seedId);
  if (!seed) throw new Error("SEED_NOT_FOUND");

  await ensureWorkItemBelongsToWorkspace(workspaceId, workItemId);

  const [inserted] = await db
    .insert(seedWorkItemLinks)
    .values({
      seedId,
      workItemId,
      linkType,
      createdBy,
    })
    .onConflictDoNothing({
      target: [seedWorkItemLinks.seedId, seedWorkItemLinks.workItemId],
    })
    .returning();

  if (inserted) {
    await insertEntityEvents([
      {
        entityType: SEED_ENTITY_TYPE,
        entityId: seedId,
        eventType: "work_item_linked",
        triggeredBy: eventContext.triggeredBy,
        triggeredByUserId: eventContext.triggeredByUserId,
        metadata: { workItemId, linkType },
      },
    ]);
    return inserted;
  }

  const [existing] = await db
    .select()
    .from(seedWorkItemLinks)
    .where(
      and(
        eq(seedWorkItemLinks.seedId, seedId),
        eq(seedWorkItemLinks.workItemId, workItemId)
      )
    )
    .limit(1);

  if (!existing) throw new Error("FAILED_TO_LINK_WORK_ITEM");
  return existing;
};

// ── Tags ──────────────────────────────────────────────────────────────────

export const addTagToSeed = async (
  seedId: string,
  tagId: string
): Promise<void> => {
  await db
    .insert(seedTags)
    .values({ seedId, tagId })
    .onConflictDoNothing({
      target: [seedTags.seedId, seedTags.tagId],
    });
};

export const removeTagFromSeed = async (
  seedId: string,
  tagId: string
): Promise<boolean> => {
  const deleted = await db
    .delete(seedTags)
    .where(
      and(
        eq(seedTags.seedId, seedId),
        eq(seedTags.tagId, tagId)
      )
    )
    .returning({ id: seedTags.id });

  return deleted.length > 0;
};

export const getTagsBySeed = async (
  seedId: string
): Promise<{ id: string; name: string; color: string }[]> => {
  return db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(seedTags)
    .innerJoin(tags, eq(seedTags.tagId, tags.id))
    .where(eq(seedTags.seedId, seedId));
};

// ── Events ────────────────────────────────────────────────────────────────

export const getSeedEvents = async (
  _workspaceId: string,
  seedId: string,
  pagination: PaginationParams,
  filters?: EntityEventFilters
): Promise<{ items: EntityEventWithUser[]; total: number }> => {
  return getEntityEventsGeneric(SEED_ENTITY_TYPE, seedId, pagination, filters);
};
