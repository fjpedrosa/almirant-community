import { db } from "../../client";
import {
  sprints,
  sprintWorkItems,
  workItems,
  workItemAssignees,
  user,
  boards,
  boardColumns,
  workItemEvents,
  aiSessions,
} from "../../schema";
import { eq, and, sql, desc, isNull, inArray, gte, lte, exists } from "drizzle-orm";

// Verify that a board belongs to the given workspace. Returns the board id if valid, null otherwise.
const verifyBoardOrg = async (
  boardId: string,
  workspaceId: string
): Promise<string | null> => {
  const [board] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.workspaceId, workspaceId)))
    .limit(1);
  return board?.id ?? null;
};
import type {
  SprintWithCount,
  CreateSprintRequest,
  SprintWorkItemDetail,
  SprintWorkItemDetailExtended,
  SprintComparison,
  UserSprintStats,
  DoneItemPreview,
  DoneItemAncestor,
  CompletedWorkItemByDate,
} from "../../domain/types";

// Resolve up to 3 levels of ancestors for a set of items (batch queries)
const resolveAncestors = async (
  items: { id: string; parentId: string | null }[]
): Promise<Map<string, DoneItemAncestor[]>> => {
  const ancestryMap = new Map<string, DoneItemAncestor[]>();
  const itemParentIds = new Map<string, string>();

  for (const item of items) {
    ancestryMap.set(item.id, []);
    if (item.parentId) {
      itemParentIds.set(item.id, item.parentId);
    }
  }

  let currentLookups = itemParentIds;
  for (let level = 0; level < 3 && currentLookups.size > 0; level++) {
    const parentIdsToFetch = [...new Set(currentLookups.values())];
    if (parentIdsToFetch.length === 0) break;

    const parents = await db
      .select({
        id: workItems.id,
        title: workItems.title,
        type: workItems.type,
        parentId: workItems.parentId,
      })
      .from(workItems)
      .where(inArray(workItems.id, parentIdsToFetch));

    const parentMap = new Map(parents.map((p) => [p.id, p]));
    const nextLookups = new Map<string, string>();

    for (const [itemId, parentId] of currentLookups) {
      const parent = parentMap.get(parentId);
      if (parent) {
        ancestryMap.get(itemId)!.push({
          id: parent.id,
          title: parent.title,
          type: parent.type,
        });
        if (parent.parentId) {
          nextLookups.set(itemId, parent.parentId);
        }
      }
    }

    currentLookups = nextLookups;
  }

  return ancestryMap;
};

// List sprints for a board, open sprint on top (closedAt NULL first), then by closedAt DESC
export const getSprintsByBoard = async (
  workspaceId: string,
  boardId: string
): Promise<SprintWithCount[]> => {
  const validBoard = await verifyBoardOrg(boardId, workspaceId);
  if (!validBoard) return [];
  const result = await db
    .select({
      id: sprints.id,
      boardId: sprints.boardId,
      name: sprints.name,
      status: sprints.status,
      startDate: sprints.startDate,
      endDate: sprints.endDate,
      closedAt: sprints.closedAt,
      createdAt: sprints.createdAt,
      updatedAt: sprints.updatedAt,
      workItemCount: sql<number>`(
        SELECT count(*)::int FROM sprint_work_items
        WHERE sprint_work_items.sprint_id = ${sprints.id}
      )`,
    })
    .from(sprints)
    .where(eq(sprints.boardId, boardId))
    .orderBy(
      sql`${sprints.closedAt} IS NOT NULL ASC`,
      desc(sprints.closedAt),
      desc(sprints.createdAt)
    );

  return result as SprintWithCount[];
};

// Get the active (open) sprint for a board, null if none
export const getActiveSprint = async (
  workspaceId: string,
  boardId: string
): Promise<SprintWithCount | null> => {
  const validBoard = await verifyBoardOrg(boardId, workspaceId);
  if (!validBoard) return null;
  const [result] = await db
    .select({
      id: sprints.id,
      boardId: sprints.boardId,
      name: sprints.name,
      status: sprints.status,
      startDate: sprints.startDate,
      endDate: sprints.endDate,
      closedAt: sprints.closedAt,
      createdAt: sprints.createdAt,
      updatedAt: sprints.updatedAt,
      workItemCount: sql<number>`(
        SELECT count(*)::int FROM sprint_work_items
        WHERE sprint_work_items.sprint_id = ${sprints.id}
      )`,
    })
    .from(sprints)
    .where(and(eq(sprints.boardId, boardId), eq(sprints.status, "open")))
    .limit(1);

  return (result as SprintWithCount) ?? null;
};

// Get sprint by id
export const getSprintById = async (
  workspaceId: string,
  id: string
): Promise<SprintWithCount | null> => {
  const [result] = await db
    .select({
      id: sprints.id,
      boardId: sprints.boardId,
      name: sprints.name,
      status: sprints.status,
      startDate: sprints.startDate,
      endDate: sprints.endDate,
      closedAt: sprints.closedAt,
      createdAt: sprints.createdAt,
      updatedAt: sprints.updatedAt,
      workItemCount: sql<number>`(
        SELECT count(*)::int FROM sprint_work_items
        WHERE sprint_work_items.sprint_id = ${sprints.id}
      )`,
    })
    .from(sprints)
    .innerJoin(boards, eq(sprints.boardId, boards.id))
    .where(and(eq(sprints.id, id), eq(boards.workspaceId, workspaceId)))
    .limit(1);

  return (result as SprintWithCount) ?? null;
};

// Create a new sprint, validating no other open sprint exists for the board
export const createSprint = async (
  workspaceId: string,
  data: CreateSprintRequest
): Promise<SprintWithCount> => {
  // Verify board belongs to org
  const validBoard = await verifyBoardOrg(data.boardId, workspaceId);
  if (!validBoard) {
    throw new Error("Board not found or does not belong to the workspace");
  }

  // Validate no open sprint exists for this board
  const [existing] = await db
    .select({ id: sprints.id })
    .from(sprints)
    .where(and(eq(sprints.boardId, data.boardId), eq(sprints.status, "open")))
    .limit(1);

  if (existing) {
    throw new Error("Ya existe un sprint abierto en este board");
  }

  const [newSprint] = await db
    .insert(sprints)
    .values({
      boardId: data.boardId,
      name: data.name,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
    })
    .returning();

  return getSprintById(workspaceId, newSprint!.id) as Promise<SprintWithCount>;
};

// Helper: filter done items by optional date range based on metadata.finishedAt
const filterItemsByDateRange = (
  items: { id: string; metadata: Record<string, unknown> | null }[],
  filterStart: Date | undefined,
  filterEnd: Date | undefined,
  fallbackDate: Date
) => {
  if (!filterStart && !filterEnd) return items;

  return items.filter((item) => {
    const meta = (item.metadata as Record<string, unknown>) ?? {};
    const finishedAt = meta.finishedAt
      ? new Date(meta.finishedAt as string)
      : fallbackDate;
    if (filterStart && finishedAt < filterStart) return false;
    if (filterEnd && finishedAt > filterEnd) return false;
    return true;
  });
};

/**
 * After archiving leaf items, cascade archival up the hierarchy.
 * If ALL children of a parent are archived, archive the parent too, then recurse.
 * Works within a transaction (tx).
 */
const cascadeArchiveParents = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  archivedItemIds: string[],
  now: Date
): Promise<void> => {
  if (archivedItemIds.length === 0) return;

  // Get unique parent IDs of the just-archived items
  const archivedItems = await tx
    .select({ id: workItems.id, parentId: workItems.parentId })
    .from(workItems)
    .where(inArray(workItems.id, archivedItemIds));

  const parentIds = [...new Set(
    archivedItems.map((i) => i.parentId).filter((pid): pid is string => pid !== null)
  )];

  if (parentIds.length === 0) return;

  // For each parent, check if it has ANY non-archived children
  const parentsToArchive: string[] = [];
  for (const parentId of parentIds) {
    const [activeChild] = await tx
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.parentId, parentId), isNull(workItems.archivedAt)))
      .limit(1);

    if (!activeChild) {
      parentsToArchive.push(parentId);
    }
  }

  if (parentsToArchive.length === 0) return;

  await tx
    .update(workItems)
    .set({ archivedAt: now, updatedAt: now })
    .where(inArray(workItems.id, parentsToArchive));

  // Recurse up the hierarchy (story → feature → epic)
  await cascadeArchiveParents(tx, parentsToArchive, now);
};

// Close a sprint: archive done items, record them as sprint work items, mark sprint as closed
// When startDate/endDate are provided, only items whose finishedAt falls within that range are included
export const closeSprint = async (
  workspaceId: string,
  sprintId: string,
  boardId: string,
  options?: { startDate?: string; endDate?: string }
): Promise<SprintWithCount> => {
  const validBoard = await verifyBoardOrg(boardId, workspaceId);
  if (!validBoard) {
    throw new Error("Board not found or does not belong to the workspace");
  }
  const filterStart = options?.startDate
    ? new Date(options.startDate)
    : undefined;
  const filterEnd = options?.endDate ? new Date(options.endDate) : undefined;

  return await db.transaction(async (tx) => {
    // a. Get all done columns for this board
    const doneColumns = await tx
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(
        and(eq(boardColumns.boardId, boardId), eq(boardColumns.isDone, true))
      );

    const doneColumnIds = doneColumns.map((c) => c.id);

    let archivedCount = 0;

    if (doneColumnIds.length > 0) {
      // Get work items in done columns that are not archived
      const doneItems = await tx
        .select({
          id: workItems.id,
          metadata: workItems.metadata,
        })
        .from(workItems)
        .where(
          and(
            eq(workItems.boardId, boardId),
            inArray(workItems.boardColumnId, doneColumnIds),
            isNull(workItems.archivedAt)
          )
        );

      // Filter by date range if startDate/endDate are provided
      const now = new Date();
      const filteredItems = filterItemsByDateRange(
        doneItems,
        filterStart,
        filterEnd,
        now
      );

      if (filteredItems.length > 0) {
        // b. Insert into sprintWorkItems with completedAt from metadata.finishedAt or now
        await tx.insert(sprintWorkItems).values(
          filteredItems.map((item) => {
            const meta = (item.metadata as Record<string, unknown>) ?? {};
            const finishedAt = meta.finishedAt
              ? new Date(meta.finishedAt as string)
              : now;
            return {
              sprintId,
              workItemId: item.id,
              completedAt: finishedAt,
            };
          })
        );

        // c. Set archivedAt on those items
        const filteredItemIds = filteredItems.map((item) => item.id);
        await tx
          .update(workItems)
          .set({ archivedAt: now, updatedAt: now })
          .where(inArray(workItems.id, filteredItemIds));

        // d. Cascade archival to parent items with all children archived
        await cascadeArchiveParents(tx, filteredItemIds, now);

        archivedCount = filteredItems.length;
      }
    }

    // e. Update sprint: status='closed', closedAt=now
    const now = new Date();
    await tx
      .update(sprints)
      .set({ status: "closed", closedAt: now, updatedAt: now })
      .where(eq(sprints.id, sprintId));

    // e. Return the closed sprint with workItemCount
    const [closedSprint] = await tx
      .select({
        id: sprints.id,
        boardId: sprints.boardId,
        name: sprints.name,
        status: sprints.status,
        startDate: sprints.startDate,
        endDate: sprints.endDate,
        closedAt: sprints.closedAt,
        createdAt: sprints.createdAt,
        updatedAt: sprints.updatedAt,
      })
      .from(sprints)
      .where(eq(sprints.id, sprintId))
      .limit(1);

    return {
      ...closedSprint,
      workItemCount: archivedCount,
    } as SprintWithCount;
  });
};

// Close a sprint by date: create + close immediately with explicit start/end dates
// Filters done items to only include those with finishedAt within the date range
export const closeSprintByDate = async (
  workspaceId: string,
  boardId: string,
  name: string,
  startDate: string,
  endDate: string
): Promise<SprintWithCount> => {
  const validBoard = await verifyBoardOrg(boardId, workspaceId);
  if (!validBoard) {
    throw new Error("Board not found or does not belong to the workspace");
  }
  const filterStart = new Date(startDate);
  const filterEnd = new Date(endDate);
  // Include the entire end day for filtering
  filterEnd.setUTCHours(23, 59, 59, 999);

  return await db.transaction(async (tx) => {
    // Create the sprint with explicit dates
    const [newSprint] = await tx
      .insert(sprints)
      .values({
        boardId,
        name,
        startDate: filterStart,
        endDate: filterEnd,
      })
      .returning();

    const sprintId = newSprint!.id;

    // Get done columns for this board
    const doneColumns = await tx
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(
        and(eq(boardColumns.boardId, boardId), eq(boardColumns.isDone, true))
      );

    const doneColumnIds = doneColumns.map((c) => c.id);
    let archivedCount = 0;

    if (doneColumnIds.length > 0) {
      // Get work items in done columns that are not archived
      const doneItems = await tx
        .select({
          id: workItems.id,
          metadata: workItems.metadata,
        })
        .from(workItems)
        .where(
          and(
            eq(workItems.boardId, boardId),
            inArray(workItems.boardColumnId, doneColumnIds),
            isNull(workItems.archivedAt)
          )
        );

      // Filter by date range
      const now = new Date();
      const filteredItems = filterItemsByDateRange(
        doneItems,
        filterStart,
        filterEnd,
        now
      );

      if (filteredItems.length > 0) {
        // Insert into sprintWorkItems
        await tx.insert(sprintWorkItems).values(
          filteredItems.map((item) => {
            const meta = (item.metadata as Record<string, unknown>) ?? {};
            const finishedAt = meta.finishedAt
              ? new Date(meta.finishedAt as string)
              : now;
            return {
              sprintId,
              workItemId: item.id,
              completedAt: finishedAt,
            };
          })
        );

        // Archive those items
        const filteredItemIds = filteredItems.map((item) => item.id);
        await tx
          .update(workItems)
          .set({ archivedAt: now, updatedAt: now })
          .where(inArray(workItems.id, filteredItemIds));

        // Cascade archival to parent items with all children archived
        await cascadeArchiveParents(tx, filteredItemIds, now);

        archivedCount = filteredItems.length;
      }
    }

    // Close the sprint immediately
    const now = new Date();
    await tx
      .update(sprints)
      .set({ status: "closed", closedAt: now, updatedAt: now })
      .where(eq(sprints.id, sprintId));

    const [closedSprint] = await tx
      .select({
        id: sprints.id,
        boardId: sprints.boardId,
        name: sprints.name,
        status: sprints.status,
        startDate: sprints.startDate,
        endDate: sprints.endDate,
        closedAt: sprints.closedAt,
        createdAt: sprints.createdAt,
        updatedAt: sprints.updatedAt,
      })
      .from(sprints)
      .where(eq(sprints.id, sprintId))
      .limit(1);

    return {
      ...closedSprint,
      workItemCount: archivedCount,
    } as SprintWithCount;
  });
};

// Close a sprint ad-hoc: create + close immediately in a single transaction
// When startDate/endDate are provided, only items whose finishedAt falls within that range are included
export const closeSprintAdHoc = async (
  workspaceId: string,
  boardId: string,
  name: string,
  options?: { startDate?: string; endDate?: string }
): Promise<SprintWithCount> => {
  const validBoard = await verifyBoardOrg(boardId, workspaceId);
  if (!validBoard) {
    throw new Error("Board not found or does not belong to the workspace");
  }
  const filterStart = options?.startDate
    ? new Date(options.startDate)
    : undefined;
  const filterEnd = options?.endDate ? new Date(options.endDate) : undefined;

  return await db.transaction(async (tx) => {
    // Create the sprint
    const [newSprint] = await tx
      .insert(sprints)
      .values({
        boardId,
        name,
      })
      .returning();

    const sprintId = newSprint!.id;

    // Get done columns for this board
    const doneColumns = await tx
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(
        and(eq(boardColumns.boardId, boardId), eq(boardColumns.isDone, true))
      );

    const doneColumnIds = doneColumns.map((c) => c.id);
    let archivedCount = 0;

    if (doneColumnIds.length > 0) {
      // Get work items in done columns that are not archived
      const doneItems = await tx
        .select({
          id: workItems.id,
          metadata: workItems.metadata,
        })
        .from(workItems)
        .where(
          and(
            eq(workItems.boardId, boardId),
            inArray(workItems.boardColumnId, doneColumnIds),
            isNull(workItems.archivedAt)
          )
        );

      // Filter by date range if startDate/endDate are provided
      const now = new Date();
      const filteredItems = filterItemsByDateRange(
        doneItems,
        filterStart,
        filterEnd,
        now
      );

      if (filteredItems.length > 0) {
        // Insert into sprintWorkItems
        await tx.insert(sprintWorkItems).values(
          filteredItems.map((item) => {
            const meta = (item.metadata as Record<string, unknown>) ?? {};
            const finishedAt = meta.finishedAt
              ? new Date(meta.finishedAt as string)
              : now;
            return {
              sprintId,
              workItemId: item.id,
              completedAt: finishedAt,
            };
          })
        );

        // Archive those items
        const filteredItemIds = filteredItems.map((item) => item.id);
        await tx
          .update(workItems)
          .set({ archivedAt: now, updatedAt: now })
          .where(inArray(workItems.id, filteredItemIds));

        // Cascade archival to parent items with all children archived
        await cascadeArchiveParents(tx, filteredItemIds, now);

        archivedCount = filteredItems.length;
      }
    }

    // Close the sprint immediately
    const now = new Date();
    await tx
      .update(sprints)
      .set({ status: "closed", closedAt: now, updatedAt: now })
      .where(eq(sprints.id, sprintId));

    const [closedSprint] = await tx
      .select({
        id: sprints.id,
        boardId: sprints.boardId,
        name: sprints.name,
        status: sprints.status,
        startDate: sprints.startDate,
        endDate: sprints.endDate,
        closedAt: sprints.closedAt,
        createdAt: sprints.createdAt,
        updatedAt: sprints.updatedAt,
      })
      .from(sprints)
      .where(eq(sprints.id, sprintId))
      .limit(1);

    return {
      ...closedSprint,
      workItemCount: archivedCount,
    } as SprintWithCount;
  });
};

// Get work items for a sprint via join sprintWorkItems + workItems
export const getSprintWorkItems = async (
  workspaceId: string,
  sprintId: string
): Promise<SprintWorkItemDetail[]> => {
  const result = await db
    .select({
      id: sprintWorkItems.id,
      workItemId: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      type: workItems.type,
      priority: workItems.priority,
      assignee: workItems.assignee,
      completedAt: sprintWorkItems.completedAt,
    })
    .from(sprintWorkItems)
    .innerJoin(workItems, eq(sprintWorkItems.workItemId, workItems.id))
    .innerJoin(sprints, eq(sprintWorkItems.sprintId, sprints.id))
    .innerJoin(boards, eq(sprints.boardId, boards.id))
    .where(and(eq(sprintWorkItems.sprintId, sprintId), eq(boards.workspaceId, workspaceId)))
    .orderBy(desc(sprintWorkItems.completedAt));

  return result as SprintWorkItemDetail[];
};

// Get the next sprint number: count of closed sprints + 1
export const getNextSprintNumber = async (
  workspaceId: string,
  boardId: string
): Promise<number> => {
  const validBoard = await verifyBoardOrg(boardId, workspaceId);
  if (!validBoard) return 1;
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sprints)
    .where(
      and(eq(sprints.boardId, boardId), eq(sprints.status, "closed"))
    );

  return (result?.count ?? 0) + 1;
};

// Get work items in isDone columns that are NOT archived (preview before closing)
export const getDoneItemsPreview = async (
  workspaceId: string,
  boardId: string
): Promise<DoneItemPreview[]> => {
  const validBoard = await verifyBoardOrg(boardId, workspaceId);
  if (!validBoard) return [];
  // Get done columns
  const doneColumns = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(
      and(eq(boardColumns.boardId, boardId), eq(boardColumns.isDone, true))
    );

  const doneColumnIds = doneColumns.map((c) => c.id);

  if (doneColumnIds.length === 0) return [];

  const result = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      type: workItems.type,
      priority: workItems.priority,
      assignee: workItems.assignee,
      metadata: workItems.metadata,
      parentId: workItems.parentId,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.boardId, boardId),
        inArray(workItems.boardColumnId, doneColumnIds),
        isNull(workItems.archivedAt)
      )
    )
    .orderBy(desc(workItems.updatedAt));

  // Resolve ancestors (up to 3 levels) for hierarchy grouping
  const ancestryMap = await resolveAncestors(
    result.map((item) => ({ id: item.id, parentId: item.parentId }))
  );

  return result.map((item) => {
    const meta = (item.metadata as Record<string, unknown>) ?? {};
    const ancestors = ancestryMap.get(item.id);
    return {
      id: item.id,
      title: item.title,
      type: item.type,
      priority: item.priority,
      assignee: item.assignee,
      finishedAt: (meta.finishedAt as string) ?? null,
      parentId: item.parentId ?? undefined,
      ancestors: ancestors && ancestors.length > 0 ? ancestors : undefined,
    };
  }) as DoneItemPreview[];
};

// Get work items that were completed (moved to isDone column) within a date range.
// Combines two sources:
// 1. work_item_events: "moved" events where target column has isDone=true
// 2. Fallback: work items currently in done columns filtered by updatedAt (for items without events)
// Both sources are merged and deduplicated to get the complete picture.
export const getCompletedWorkItemsByDateRange = async (
  workspaceId: string,
  boardId: string,
  startDate: Date,
  endDate: Date
): Promise<CompletedWorkItemByDate[]> => {
  const validBoard = await verifyBoardOrg(boardId, workspaceId);
  if (!validBoard) return [];
  // Step 1: Get all isDone column IDs for this board
  const doneColumns = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(
      and(eq(boardColumns.boardId, boardId), eq(boardColumns.isDone, true))
    );

  const doneColumnIds = doneColumns.map((c) => c.id);

  if (doneColumnIds.length === 0) return [];

  // Step 2: Get items from events (items moved to done columns within date range)
  const eventResults = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      type: workItems.type,
      priority: workItems.priority,
      assignee: workItems.assignee,
      taskId: workItems.taskId,
      boardColumnId: workItems.boardColumnId,
      completedAt: workItemEvents.createdAt,
      parentId: workItems.parentId,
    })
    .from(workItemEvents)
    .innerJoin(workItems, eq(workItemEvents.workItemId, workItems.id))
    .where(
      and(
        eq(workItems.boardId, boardId),
        eq(workItemEvents.eventType, "moved"),
        eq(workItemEvents.fieldName, "boardColumnId"),
        inArray(workItemEvents.newValue, doneColumnIds),
        gte(workItemEvents.createdAt, startDate),
        lte(workItemEvents.createdAt, endDate)
      )
    )
    .orderBy(desc(workItemEvents.createdAt));

  // Deduplicate events: keep only the latest completion event per work item
  const seen = new Set<string>();
  const results: CompletedWorkItemByDate[] = [];
  for (const row of eventResults) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      results.push({
        ...row,
        parentId: row.parentId ?? undefined,
      } as CompletedWorkItemByDate);
    }
  }

  // Step 3: Also get items currently in done columns with updatedAt in range
  // that were NOT already found via events (covers items without event history)
  const fallbackResults = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      type: workItems.type,
      priority: workItems.priority,
      assignee: workItems.assignee,
      taskId: workItems.taskId,
      boardColumnId: workItems.boardColumnId,
      completedAt: workItems.updatedAt,
      parentId: workItems.parentId,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.boardId, boardId),
        inArray(workItems.boardColumnId, doneColumnIds),
        isNull(workItems.archivedAt),
        gte(workItems.updatedAt, startDate),
        lte(workItems.updatedAt, endDate)
      )
    )
    .orderBy(desc(workItems.updatedAt));

  // Merge: add fallback items not already found via events
  for (const row of fallbackResults) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      results.push({
        ...row,
        parentId: row.parentId ?? undefined,
      } as CompletedWorkItemByDate);
    }
  }

  // Resolve ancestors (up to 3 levels) for hierarchy grouping
  const ancestryMap = await resolveAncestors(
    results.map((item) => ({ id: item.id, parentId: item.parentId ?? null }))
  );

  return results.map((item) => {
    const ancestors = ancestryMap.get(item.id);
    return {
      ...item,
      ancestors: ancestors && ancestors.length > 0 ? ancestors : undefined,
    };
  });
};

// Get work items for a sprint with projectId included (for report filtering)
export const getSprintWorkItemsExtended = async (
  workspaceId: string,
  sprintId: string
): Promise<SprintWorkItemDetailExtended[]> => {
  const result = await db
    .select({
      id: sprintWorkItems.id,
      workItemId: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      type: workItems.type,
      priority: workItems.priority,
      assignee: workItems.assignee,
      completedAt: sprintWorkItems.completedAt,
      projectId: workItems.projectId,
    })
    .from(sprintWorkItems)
    .innerJoin(workItems, eq(sprintWorkItems.workItemId, workItems.id))
    .innerJoin(sprints, eq(sprintWorkItems.sprintId, sprints.id))
    .innerJoin(boards, eq(sprints.boardId, boards.id))
    .where(and(eq(sprintWorkItems.sprintId, sprintId), eq(boards.workspaceId, workspaceId)))
    .orderBy(desc(sprintWorkItems.completedAt));

  return result as SprintWorkItemDetailExtended[];
};

// Get the most common projectId among a sprint's work items (majority project).
// Returns null only when the sprint has zero items.
export const getSprintMajorityProjectId = async (
  workspaceId: string,
  sprintId: string
): Promise<string | null> => {
  const [row] = await db
    .select({
      projectId: workItems.projectId,
      count: sql<number>`count(*)::int`.as("cnt"),
    })
    .from(sprintWorkItems)
    .innerJoin(workItems, eq(sprintWorkItems.workItemId, workItems.id))
    .innerJoin(sprints, eq(sprintWorkItems.sprintId, sprints.id))
    .innerJoin(boards, eq(sprints.boardId, boards.id))
    .where(and(eq(sprintWorkItems.sprintId, sprintId), eq(boards.workspaceId, workspaceId)))
    .groupBy(workItems.projectId)
    .orderBy(sql`cnt DESC`)
    .limit(1);

  return row?.projectId ?? null;
};

// Get user contribution stats for a sprint (created/assigned/completed per user)
export const getSprintUserContributionStats = async (
  workspaceId: string,
  sprintId: string
): Promise<UserSprintStats[]> => {
  // 1) Get sprint items (work item ids + createdBy + boardId), verified against org
  const items = await db
    .select({
      workItemId: sprintWorkItems.workItemId,
      createdByUserId: workItems.createdByUserId,
      boardId: workItems.boardId,
    })
    .from(sprintWorkItems)
    .innerJoin(workItems, eq(sprintWorkItems.workItemId, workItems.id))
    .innerJoin(sprints, eq(sprintWorkItems.sprintId, sprints.id))
    .innerJoin(boards, eq(sprints.boardId, boards.id))
    .where(and(eq(sprintWorkItems.sprintId, sprintId), eq(boards.workspaceId, workspaceId)));

  if (items.length === 0) return [];

  const workItemIds = items.map((i) => i.workItemId);

  // 2) Get done column IDs from the board (use first item's boardId)
  const boardId = items[0]!.boardId;
  const doneColumns = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(
      and(eq(boardColumns.boardId, boardId), eq(boardColumns.isDone, true))
    );
  const doneColumnIds = doneColumns.map((c) => c.id);

  // 3) Fetch assignees for those items (only role='responsible')
  const assignees = await db
    .select({ workItemId: workItemAssignees.workItemId, userId: workItemAssignees.userId })
    .from(workItemAssignees)
    .where(
      and(
        inArray(workItemAssignees.workItemId, workItemIds),
        eq(workItemAssignees.role, "responsible")
      )
    );

  // 4) Fetch completions from work_item_events (moved to done columns)
  const completionEvents = doneColumnIds.length > 0
    ? await db
        .select({
          triggeredByUserId: workItemEvents.triggeredByUserId,
          workItemId: workItemEvents.workItemId,
        })
        .from(workItemEvents)
        .where(
          and(
            inArray(workItemEvents.workItemId, workItemIds),
            eq(workItemEvents.eventType, "moved"),
            eq(workItemEvents.fieldName, "boardColumnId"),
            inArray(workItemEvents.newValue, doneColumnIds)
          )
        )
    : [];

  // 5) Determine involved users
  const userIds = new Set<string>();
  for (const i of items) {
    if (i.createdByUserId) userIds.add(i.createdByUserId);
  }
  for (const a of assignees) userIds.add(a.userId);
  for (const e of completionEvents) {
    if (e.triggeredByUserId) userIds.add(e.triggeredByUserId);
  }

  if (userIds.size === 0) return [];

  const users = await db
    .select({ id: user.id, name: user.name, image: user.image })
    .from(user)
    .where(inArray(user.id, Array.from(userIds)));

  const byUser = new Map<string, UserSprintStats>();
  for (const u of users) {
    byUser.set(u.id, {
      userId: u.id,
      userName: u.name,
      userImage: u.image ?? null,
      tasksCreated: 0,
      tasksCompleted: 0,
      tasksAssigned: 0,
    });
  }

  // tasksCreated: count by createdByUserId
  for (const i of items) {
    if (!i.createdByUserId) continue;
    const entry = byUser.get(i.createdByUserId);
    if (!entry) continue;
    entry.tasksCreated += 1;
  }

  // tasksAssigned: count by responsible assignees (deduplicated per user+workItem)
  const assignedPairs = new Set<string>();
  for (const a of assignees) {
    const entry = byUser.get(a.userId);
    if (!entry) continue;

    const key = `${a.userId}:${a.workItemId}`;
    if (!assignedPairs.has(key)) {
      assignedPairs.add(key);
      entry.tasksAssigned += 1;
    }
  }

  // tasksCompleted: count by triggeredByUserId from work_item_events (deduplicated per user+workItem)
  const completedPairs = new Set<string>();
  for (const e of completionEvents) {
    if (!e.triggeredByUserId) continue;
    const entry = byUser.get(e.triggeredByUserId);
    if (!entry) continue;

    const key = `${e.triggeredByUserId}:${e.workItemId}`;
    if (!completedPairs.has(key)) {
      completedPairs.add(key);
      entry.tasksCompleted += 1;
    }
  }

  return Array.from(byUser.values()).sort((a, b) =>
    (b.tasksCreated + b.tasksCompleted + b.tasksAssigned) -
    (a.tasksCreated + a.tasksCompleted + a.tasksAssigned)
  );
};

export const getAiCostForWorkItems = async (
  workItemIds: string[]
): Promise<{ totalSessions: number; totalTokens: number; totalCost: number }> => {
  if (workItemIds.length === 0) {
    return { totalSessions: 0, totalTokens: 0, totalCost: 0 };
  }

  const [result] = await db
    .select({
      totalSessions: sql<number>`count(*)::int`,
      totalTokens: sql<number>`coalesce(sum(${aiSessions.totalTokens}), 0)::int`,
      totalCost: sql<number>`coalesce(sum(${aiSessions.estimatedCost}::numeric), 0)::float`,
    })
    .from(aiSessions)
    .where(inArray(aiSessions.workItemId, workItemIds));

  return {
    totalSessions: result?.totalSessions ?? 0,
    totalTokens: result?.totalTokens ?? 0,
    totalCost: result?.totalCost ?? 0,
  };
};

// Get summary metrics for the N most recent closed sprints on the same board (excluding a given sprint)
export const getPreviousSprintsSummary = async (
  workspaceId: string,
  boardId: string,
  excludeSprintId: string,
  limit: number = 5
): Promise<SprintComparison[]> => {
  const validBoard = await verifyBoardOrg(boardId, workspaceId);
  if (!validBoard) return [];
  // 1. Get the N most recent closed sprints for this board, excluding the current one
  const previousSprints = await db
    .select({
      id: sprints.id,
      name: sprints.name,
      startDate: sprints.startDate,
      endDate: sprints.endDate,
      closedAt: sprints.closedAt,
      createdAt: sprints.createdAt,
    })
    .from(sprints)
    .where(
      and(
        eq(sprints.boardId, boardId),
        eq(sprints.status, "closed"),
        sql`${sprints.id} != ${excludeSprintId}`
      )
    )
    .orderBy(desc(sprints.closedAt))
    .limit(limit);

  if (previousSprints.length === 0) return [];

  // 2. For each previous sprint, compute completed/carryover counts and velocity
  const comparisons: SprintComparison[] = [];

  for (const prev of previousSprints) {
    // Get all work items for this sprint
    const items = await db
      .select({
        completedAt: sprintWorkItems.completedAt,
      })
      .from(sprintWorkItems)
      .where(eq(sprintWorkItems.sprintId, prev.id));

    const completedCount = items.filter((i) => i.completedAt !== null).length;
    const carryoverCount = items.filter((i) => i.completedAt === null).length;

    // Calculate velocity (tasks per day)
    const sprintStart = prev.startDate ?? prev.createdAt;
    const sprintEnd = prev.closedAt ?? prev.endDate ?? new Date();
    const durationMs = Math.max(
      new Date(sprintEnd).getTime() - new Date(sprintStart).getTime(),
      1
    );
    const durationDays = durationMs / (1000 * 60 * 60 * 24);
    const velocity =
      durationDays > 0
        ? Math.round((completedCount / durationDays) * 100) / 100
        : 0;

    comparisons.push({
      sprintId: prev.id,
      sprintName: prev.name,
      completedCount,
      carryoverCount,
      velocity,
      startDate: prev.startDate,
      endDate: prev.endDate,
      closedAt: prev.closedAt,
    });
  }

  return comparisons;
};

