import { db } from "../../client";
import {
  workItems,
  workItemTags,
  workItemAssignees,
  tags,
  projects,
  boards,
  boardColumns,
  taskIdCounters,
  workItemEvents,
  user,
  sprintWorkItems,
} from "../../schema";
import { eq, and, or, ilike, desc, asc, sql, inArray, isNull, isNotNull } from "drizzle-orm";
import { getAssigneesByWorkItem, getAssigneesByWorkItemIds } from "./assignee-repository";
import type {
  WorkItemWithRelations,
  WorkItemWithContext,
  CreateWorkItemRequest,
  UpdateWorkItemRequest,
  WorkItemFilters,
  WorkItemsByColumn,
  WorkItemType,
  Priority,
  AncestorInfo,
  BoardArea,
  BoardColumn,
  ColumnRole,
} from "../../domain/types";
import { isParentType } from "../../domain/types";
import type { PaginationParams, ChildrenSummary } from "../../domain/types";
import type { TriggeredByContext } from "./work-item-event-repository";
import { defaultTriggeredByContext } from "./work-item-event-repository";
import type { NewWorkItemEvent } from "../../schema/work-item-events";

// Helper: log a single event in the background (fire-and-forget, errors are silently caught)
const logEvent = (event: NewWorkItemEvent): void => {
  db.insert(workItemEvents).values(event).catch(() => {
    // Silently ignore event logging errors to avoid breaking main operations
  });
};

// Helper: log multiple events in the background
const logEvents = (events: NewWorkItemEvent[]): void => {
  if (events.length === 0) return;
  db.insert(workItemEvents).values(events).catch(() => {
    // Silently ignore event logging errors to avoid breaking main operations
  });
};

const buildWorkspaceScopedProjectCondition = (workspaceId: string) => {
  const orgProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(
      eq(projects.workspaceId, workspaceId),
      sql`${projects.status} != 'archived'`
    ));

  // Keep legacy/null-project records visible, but block cross-workspace leaks.
  // Archived projects are excluded so their work items don't appear in normal flows.
  return or(
    isNull(workItems.projectId),
    inArray(workItems.projectId, orgProjectIds)
  )!;
};

const isInvalidUtf8QueryError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; cause?: { code?: string } };
  return err.code === "22021" || err.cause?.code === "22021";
};

const AREA_VIRTUAL_COLUMN_ID_REGEX = /^area-(.+)-(backlog|todo|in_progress|review|testing|needs_fix|validating|release|to_document|done|other)$/;

const getNonEmptyStringMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const getStringListMetadata = (
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string[] => {
  const value = metadata?.[key];
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
};

const hasDodHumanActionRequirement = (metadata: Record<string, unknown> | null | undefined): boolean => {
  return metadata?.dod_human_action_required === true
    || metadata?.dod_human_review_required === true
    || metadata?.dod_auto_remediation_blocked === true
    || metadata?.dod_external_validation_required === true
    || getStringListMetadata(metadata, "dod_external_validation_tools").length > 0;
};

/**
 * Resolve a board column identifier to a real board_columns.id for the target board.
 * Supports both real UUID column ids and area virtual ids (area-<area>-<role>).
 */
const resolveBoardColumnIdForBoard = async (
  boardId: string,
  inputBoardColumnId: string
): Promise<string> => {
  const [directColumn] = await db
    .select({ id: boardColumns.id, boardId: boardColumns.boardId })
    .from(boardColumns)
    .where(eq(boardColumns.id, inputBoardColumnId))
    .limit(1);

  if (directColumn) {
    if (directColumn.boardId !== boardId) {
      throw new Error(
        `BOARD_COLUMN_NOT_IN_BOARD: Column "${inputBoardColumnId}" does not belong to board "${boardId}"`
      );
    }
    return directColumn.id;
  }

  const areaVirtualMatch = AREA_VIRTUAL_COLUMN_ID_REGEX.exec(inputBoardColumnId);
  if (!areaVirtualMatch) {
    throw new Error(`BOARD_COLUMN_NOT_FOUND: Column "${inputBoardColumnId}" was not found`);
  }

  const role = areaVirtualMatch[2] as ColumnRole;
  const [columnForBoardRole] = await db
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(and(eq(boardColumns.boardId, boardId), eq(boardColumns.role, role)))
    .orderBy(asc(boardColumns.order))
    .limit(1);

  if (!columnForBoardRole) {
    throw new Error(
      `BOARD_COLUMN_ROLE_NOT_FOUND: No column with role "${role}" exists for board "${boardId}"`
    );
  }

  return columnForBoardRole.id;
};

/**
 * Hydrate relations for a single work item (6 queries).
 * Use only for single-item lookups (e.g. getWorkItemById).
 * For multiple items, use batchHydrateWorkItemRelations() instead.
 */
const hydrateWorkItemRelations = async (
  item: typeof workItems.$inferSelect
): Promise<WorkItemWithRelations> => {
  const [parentResult, childrenResult, tagsResult, projectResult, boardResult, columnResult, creatorResult, assigneesResult] =
    await Promise.all([
      item.parentId
        ? db
            .select({
              id: workItems.id,
              title: workItems.title,
              type: workItems.type,
              taskId: workItems.taskId,
            })
            .from(workItems)
            .where(eq(workItems.id, item.parentId))
            .limit(1)
        : Promise.resolve([]),
      db
        .select({
          id: workItems.id,
          title: workItems.title,
          type: workItems.type,
          priority: workItems.priority,
        })
        .from(workItems)
        .where(eq(workItems.parentId, item.id)),
      db
        .select({
          id: tags.id,
          name: tags.name,
          color: tags.color,
        })
        .from(workItemTags)
        .innerJoin(tags, eq(workItemTags.tagId, tags.id))
        .where(eq(workItemTags.workItemId, item.id)),
      item.projectId
        ? db
            .select({ name: projects.name })
            .from(projects)
            .where(eq(projects.id, item.projectId))
            .limit(1)
        : Promise.resolve([]),
      db
        .select({ name: boards.name })
        .from(boards)
        .where(eq(boards.id, item.boardId))
        .limit(1),
      item.boardColumnId
        ? db
            .select({ name: boardColumns.name, color: boardColumns.color, isDone: boardColumns.isDone })
            .from(boardColumns)
            .where(eq(boardColumns.id, item.boardColumnId))
            .limit(1)
        : Promise.resolve([]),
      item.createdByUserId
        ? db
            .select({ id: user.id, name: user.name, image: user.image })
            .from(user)
            .where(eq(user.id, item.createdByUserId))
            .limit(1)
        : Promise.resolve([]),
      getAssigneesByWorkItem(item.id),
    ]);

  // If the item has a real boardColumnId, use the direct column result.
  // Otherwise (parent types: epic/feature/story), compute the virtual column.
  let columnName = columnResult[0]?.name ?? "";
  let columnColor = columnResult[0]?.color ?? "";
  let columnIsDone = columnResult[0]?.isDone ?? false;

  let childrenSummary: ChildrenSummary | undefined;

  if (!item.boardColumnId) {
    const boardColumnsForVirtual = await db
      .select({ id: boardColumns.id, order: boardColumns.order, role: boardColumns.role, isDone: boardColumns.isDone, name: boardColumns.name, color: boardColumns.color })
      .from(boardColumns)
      .where(eq(boardColumns.boardId, item.boardId))
      .orderBy(asc(boardColumns.order));

    const { virtualColumnMap, childrenSummaries } = await computeVirtualColumns(
      [item.id],
      boardColumnsForVirtual.map((c) => ({ ...c, isDone: c.isDone ?? false }))
    );
    const virtualColumnId = virtualColumnMap.get(item.id);
    if (virtualColumnId) {
      const virtualCol = boardColumnsForVirtual.find((c) => c.id === virtualColumnId);
      if (virtualCol) {
        columnName = virtualCol.name;
        columnColor = virtualCol.color ?? "";
        columnIsDone = virtualCol.isDone ?? false;
      }
    }
    childrenSummary = childrenSummaries.get(item.id);
  }

  // Build full ancestor chain (parent, grandparent, ..., root) for breadcrumb display
  const ancestryMap = await buildAncestryMap([{ id: item.id, parentId: item.parentId }]);
  const ancestors = ancestryMap.get(item.id) ?? [];

  return {
    ...item,
    parent: parentResult[0] || null,
    ancestors: ancestors.length > 0 ? ancestors : undefined,
    children: childrenResult,
    tags: tagsResult,
    assignees: assigneesResult,
    createdBy: creatorResult[0] || null,
    projectName: projectResult[0]?.name ?? "",
    boardName: boardResult[0]?.name ?? "",
    columnName,
    columnColor,
    columnIsDone,
    ...(childrenSummary ? { childrenSummary } : {}),
  } as WorkItemWithRelations;
};

/**
 * Batch-hydrate relations for multiple work items using 6 parallel batch queries.
 * Reduces O(N*6) queries to exactly 6 queries regardless of item count.
 */
const batchHydrateWorkItemRelations = async (
  items: (typeof workItems.$inferSelect)[]
): Promise<WorkItemWithRelations[]> => {
  if (items.length === 0) return [];

  const itemIds = items.map((i) => i.id);

  // Collect unique IDs for lookup queries
  const uniqueParentIds = [...new Set(items.map((i) => i.parentId).filter(Boolean))] as string[];
  const uniqueProjectIds = [...new Set(items.map((i) => i.projectId).filter(Boolean))] as string[];
  const uniqueBoardIds = [...new Set(items.map((i) => i.boardId))];
  const uniqueColumnIds = [...new Set(items.map((i) => i.boardColumnId).filter(Boolean))] as string[];
  const uniqueCreatorIds = [...new Set(items.map((i) => i.createdByUserId).filter(Boolean))] as string[];

  // 8 batch queries in parallel
  const [parentsResult, childrenResult, tagsResult, projectsResult, boardsResult, columnsResult, creatorsResult, assigneesMap] =
    await Promise.all([
      // 1. Parents
      uniqueParentIds.length > 0
        ? db
            .select({ id: workItems.id, title: workItems.title, type: workItems.type, taskId: workItems.taskId })
            .from(workItems)
            .where(inArray(workItems.id, uniqueParentIds))
        : Promise.resolve([]),
      // 2. Children (all children of any item in the batch)
      db
        .select({
          id: workItems.id,
          title: workItems.title,
          type: workItems.type,
          priority: workItems.priority,
          parentId: workItems.parentId,
        })
        .from(workItems)
        .where(inArray(workItems.parentId, itemIds)),
      // 3. Tags (join workItemTags + tags)
      db
        .select({
          workItemId: workItemTags.workItemId,
          id: tags.id,
          name: tags.name,
          color: tags.color,
        })
        .from(workItemTags)
        .innerJoin(tags, eq(workItemTags.tagId, tags.id))
        .where(inArray(workItemTags.workItemId, itemIds)),
      // 4. Projects
      uniqueProjectIds.length > 0
        ? db
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(inArray(projects.id, uniqueProjectIds))
        : Promise.resolve([]),
      // 5. Boards
      db
        .select({ id: boards.id, name: boards.name })
        .from(boards)
        .where(inArray(boards.id, uniqueBoardIds)),
      // 6. Columns
      uniqueColumnIds.length > 0
        ? db
            .select({
              id: boardColumns.id,
              name: boardColumns.name,
              color: boardColumns.color,
              isDone: boardColumns.isDone,
            })
            .from(boardColumns)
            .where(inArray(boardColumns.id, uniqueColumnIds))
        : Promise.resolve([]),
      // 7. Creators
      uniqueCreatorIds.length > 0
        ? db
            .select({ id: user.id, name: user.name, image: user.image })
            .from(user)
            .where(inArray(user.id, uniqueCreatorIds))
        : Promise.resolve([]),
      // 8. Assignees (batch query via assignee-repository)
      getAssigneesByWorkItemIds(itemIds),
    ]);

  // Build lookup maps
  const parentMap = new Map(parentsResult.map((p) => [p.id, p]));
  const childrenMap = new Map<string, typeof childrenResult>();
  for (const child of childrenResult) {
    if (!child.parentId) continue;
    const list = childrenMap.get(child.parentId);
    if (list) {
      list.push(child);
    } else {
      childrenMap.set(child.parentId, [child]);
    }
  }
  const tagsMap = new Map<string, { id: string; name: string; color: string | null }[]>();
  for (const tag of tagsResult) {
    const list = tagsMap.get(tag.workItemId);
    if (list) {
      list.push({ id: tag.id, name: tag.name, color: tag.color });
    } else {
      tagsMap.set(tag.workItemId, [{ id: tag.id, name: tag.name, color: tag.color }]);
    }
  }
  const projectMap = new Map(projectsResult.map((p) => [p.id, p]));
  const boardMap = new Map(boardsResult.map((b) => [b.id, b]));
  const columnMap = new Map(columnsResult.map((c) => [c.id, c]));
  const creatorMap = new Map(creatorsResult.map((c) => [c.id, c]));

  // Build full ancestor chains for all items in batch
  const ancestryMap = await buildAncestryMap(items.map((i) => ({ id: i.id, parentId: i.parentId })));

  // Assemble results
  return items.map((item) => {
    const parent = item.parentId ? parentMap.get(item.parentId) ?? null : null;
    const children = childrenMap.get(item.id) ?? [];
    const itemTags = tagsMap.get(item.id) ?? [];
    const project = item.projectId ? projectMap.get(item.projectId) : undefined;
    const board = boardMap.get(item.boardId);
    const column = item.boardColumnId ? columnMap.get(item.boardColumnId) : undefined;
    const creator = item.createdByUserId ? creatorMap.get(item.createdByUserId) ?? null : null;
    const ancestors = ancestryMap.get(item.id) ?? [];

    return {
      ...item,
      parent: parent ? { id: parent.id, title: parent.title, type: parent.type, taskId: parent.taskId } : null,
      ancestors: ancestors.length > 0 ? ancestors : undefined,
      children: children.map((c) => ({ id: c.id, title: c.title, type: c.type, priority: c.priority })),
      tags: itemTags,
      assignees: assigneesMap.get(item.id) ?? [],
      createdBy: creator ? { id: creator.id, name: creator.name, image: creator.image } : null,
      projectName: project?.name ?? "",
      boardName: board?.name ?? "",
      columnName: column?.name ?? "",
      columnColor: column?.color ?? "",
      columnIsDone: column?.isDone ?? false,
    } as WorkItemWithRelations;
  });
};

// Get all work items with pagination and filters
export const getWorkItems = async (
  workspaceId: string,
  pagination: PaginationParams,
  filters?: WorkItemFilters
): Promise<{ items: WorkItemWithRelations[]; total: number }> => {
  // Defense-in-depth: filter by workspace through project
  const orgProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));
  const conditions = [
    sql`${workItems.projectId} IN (${orgProjectIds})`,
  ];

  if (filters?.search) {
    conditions.push(
      or(
        ilike(workItems.title, `%${filters.search}%`),
        ilike(workItems.description, `%${filters.search}%`),
        ilike(workItems.taskId, `%${filters.search}%`)
      )!
    );
  }

  if (filters?.projectId) {
    conditions.push(eq(workItems.projectId, filters.projectId));
  }

  if (filters?.boardId) {
    conditions.push(eq(workItems.boardId, filters.boardId));
  }

  if (filters?.boardColumnId) {
    conditions.push(eq(workItems.boardColumnId, filters.boardColumnId));
  }

  if (filters?.type) {
    conditions.push(eq(workItems.type, filters.type));
  }

  if (filters?.priority) {
    conditions.push(eq(workItems.priority, filters.priority));
  }

  if (filters?.assignee) {
    conditions.push(eq(workItems.assignee, filters.assignee));
  }

  if (filters?.parentId) {
    conditions.push(eq(workItems.parentId, filters.parentId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [itemsResult, countResult] = await Promise.all([
    db
      .select()
      .from(workItems)
      .where(whereClause)
      .orderBy(desc(workItems.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workItems)
      .where(whereClause),
  ]);

  const itemsWithRelations = await batchHydrateWorkItemRelations(itemsResult);

  return {
    items: itemsWithRelations,
    total: countResult[0]?.count ?? 0,
  };
};

// Get work item by ID with relations
export const getWorkItemById = async (
  id: string,
  workspaceId?: string
): Promise<WorkItemWithRelations | null> => {
  const itemQuery = workspaceId
    ? db
        .select({ item: workItems })
        .from(workItems)
        .innerJoin(projects, eq(workItems.projectId, projects.id))
        .where(and(eq(workItems.id, id), eq(projects.workspaceId, workspaceId)))
        .limit(1)
    : db
        .select({ item: workItems })
        .from(workItems)
        .where(eq(workItems.id, id))
        .limit(1);

  const [result] = await itemQuery;
  const item = result?.item;

  if (!item) return null;
  return hydrateWorkItemRelations(item);
};

export const getWorkItemsByIds = async (
  workspaceId: string,
  ids: string[]
): Promise<WorkItemWithRelations[]> => {
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (uniqueIds.length === 0) return [];

  const rows = await db
    .select({ item: workItems })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(and(inArray(workItems.id, uniqueIds), eq(projects.workspaceId, workspaceId)));

  return batchHydrateWorkItemRelations(rows.map((r) => r.item));
};

export const getWorkItemsByTaskIds = async (
  workspaceId: string,
  taskIds: string[]
): Promise<WorkItemWithRelations[]> => {
  const uniqueTaskIds = Array.from(new Set(taskIds)).filter(Boolean);
  if (uniqueTaskIds.length === 0) return [];

  const rows = await db
    .select({ item: workItems })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(
      and(
        inArray(workItems.taskId, uniqueTaskIds),
        eq(projects.workspaceId, workspaceId)
      )
    );

  return batchHydrateWorkItemRelations(rows.map((r) => r.item));
};

// Generate a prefix from project name initials (e.g. "Almirant" → "AL", null → "XX")
export const generateProjectPrefix = (projectName: string | null): string => {
  if (!projectName) return "XX";
  const words = projectName.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return "XX";
  return words.map((w) => w[0]!.toUpperCase()).join("").slice(0, 10);
};

// Type suffix map for typed task IDs (tasks have no suffix)
const typeSuffixMap: Record<string, string> = {
  epic: "E",
  feature: "F",
  story: "S",
  idea: "I",
};

// Build the full counter prefix including the type suffix
// e.g. ("MC", "epic") → "MC-E", ("MC", "task") → "MC"
export const buildTypedPrefix = (projectPrefix: string, type: string): string => {
  const suffix = typeSuffixMap[type];
  return suffix ? `${projectPrefix}-${suffix}` : projectPrefix;
};

// Get next sequential task ID atomically using upsert
export const getNextTaskId = async (prefix: string, type: string, workspaceId: string): Promise<string> => {
  const typedPrefix = buildTypedPrefix(prefix, type);
  const [result] = await db
    .insert(taskIdCounters)
    .values({ prefix: typedPrefix, workspaceId: workspaceId ?? null, nextNumber: 2 })
    .onConflictDoUpdate({
      target: [taskIdCounters.prefix, taskIdCounters.workspaceId],
      set: { nextNumber: sql`${taskIdCounters.nextNumber} + 1` },
    })
    .returning({ currentNumber: sql<number>`${taskIdCounters.nextNumber} - 1` });
  return `${typedPrefix}-${result!.currentNumber}`;
};

/**
 * Check whether a parent work item (or any of its ancestors) is in a completed
 * (isDone) column. For leaf items with a real boardColumnId the check is a
 * simple column lookup. For parent types whose column is virtual, we use
 * `computeVirtualColumns` to derive whether all descendants are done.
 *
 * The walk is recursive up to 10 levels to cover deeply nested hierarchies
 * (epic -> feature -> story -> ...).
 */
export const isAncestorCompleted = async (
  parentId: string,
  boardId: string
): Promise<{ isCompleted: boolean; completedItem: { id: string; type: string; title: string } | null }> => {
  // Pre-load all board columns once (needed for virtual column computation)
  const allColumns = await db
    .select({
      id: boardColumns.id,
      order: boardColumns.order,
      role: boardColumns.role,
      isDone: boardColumns.isDone,
      name: boardColumns.name,
      color: boardColumns.color,
    })
    .from(boardColumns)
    .where(eq(boardColumns.boardId, boardId))
    .orderBy(asc(boardColumns.order));

  const columnById = new Map(allColumns.map((c) => [c.id, c]));

  let currentId: string | null = parentId;
  const visited = new Set<string>();

  for (let depth = 0; depth < 10 && currentId; depth++) {
    if (visited.has(currentId)) break; // prevent cycles
    visited.add(currentId);

    const [item] = await db
      .select({
        id: workItems.id,
        parentId: workItems.parentId,
        boardColumnId: workItems.boardColumnId,
        type: workItems.type,
        title: workItems.title,
      })
      .from(workItems)
      .where(eq(workItems.id, currentId))
      .limit(1);

    if (!item) break;

    let isDone = false;

    if (item.boardColumnId) {
      // Leaf item — direct column check
      const col = columnById.get(item.boardColumnId);
      isDone = col?.isDone ?? false;
    } else {
      // Parent type — compute virtual column
      const { virtualColumnMap } = await computeVirtualColumns(
        [item.id],
        allColumns.map((c) => ({ ...c, isDone: c.isDone ?? false }))
      );
      const virtualColId = virtualColumnMap.get(item.id);
      if (virtualColId) {
        const virtualCol = columnById.get(virtualColId);
        isDone = virtualCol?.isDone ?? false;
      }
    }

    if (isDone) {
      return {
        isCompleted: true,
        completedItem: { id: item.id, type: item.type, title: item.title },
      };
    }

    currentId = item.parentId;
  }

  return { isCompleted: false, completedItem: null };
};

/**
 * Checks whether the DIRECT parent work item is NOT in the Backlog column.
 *
 * - Leaf parents (with `boardColumnId`): blocked if `column.role !== "backlog"`
 * - Parent types (without `boardColumnId`): uses `computeVirtualColumns` to
 *   derive a virtual column. If the parent has no descendants (not present in
 *   the virtualColumnMap), it is treated as backlog (allowed). Otherwise,
 *   blocked if the virtual column's `role !== "backlog"`.
 *
 * Returns `{ isNotInBacklog: true, item }` when the parent is outside backlog.
 */
export const isParentNotInBacklog = async (
  parentId: string,
  boardId: string
): Promise<{ isNotInBacklog: boolean; item: { id: string; type: string; title: string } | null }> => {
  // Load all board columns
  const allColumns = await db
    .select({
      id: boardColumns.id,
      order: boardColumns.order,
      role: boardColumns.role,
      isDone: boardColumns.isDone,
    })
    .from(boardColumns)
    .where(eq(boardColumns.boardId, boardId))
    .orderBy(asc(boardColumns.order));

  const columnById = new Map(allColumns.map((c) => [c.id, c]));

  // Fetch the direct parent
  const [parent] = await db
    .select({
      id: workItems.id,
      boardColumnId: workItems.boardColumnId,
      type: workItems.type,
      title: workItems.title,
    })
    .from(workItems)
    .where(eq(workItems.id, parentId))
    .limit(1);

  if (!parent) {
    return { isNotInBacklog: false, item: null };
  }

  let role: string | undefined;

  if (parent.boardColumnId) {
    // Leaf parent -- direct column lookup
    const col = columnById.get(parent.boardColumnId);
    role = col?.role;
  } else {
    // Parent type -- compute virtual column
    const { virtualColumnMap } = await computeVirtualColumns(
      [parent.id],
      allColumns.map((c) => ({ ...c, isDone: c.isDone ?? false }))
    );
    const virtualColId = virtualColumnMap.get(parent.id);
    if (!virtualColId) {
      // Parent has no descendants -- treat as backlog (allowed)
      return { isNotInBacklog: false, item: null };
    }
    const virtualCol = columnById.get(virtualColId);
    role = virtualCol?.role;
  }

  if (role !== "backlog") {
    return {
      isNotInBacklog: true,
      item: { id: parent.id, type: parent.type, title: parent.title },
    };
  }

  return { isNotInBacklog: false, item: null };
};

// Create work item
export const createWorkItem = async (
  workspaceId: string,
  data: CreateWorkItemRequest,
  context: TriggeredByContext = defaultTriggeredByContext
): Promise<WorkItemWithRelations> => {
  const { tagIds, dueDate, id: providedId, ...workItemData } = data;
  // Parent types (epic, feature, story) have no boardColumnId -- skip resolution for them
  const resolvedBoardColumnId = workItemData.boardColumnId
    ? await resolveBoardColumnIdForBoard(workItemData.boardId, workItemData.boardColumnId)
    : null;

  // Enforce board-level type restrictions (if configured). Default is permissive.
  const [boardRow] = await db
    .select({ id: boards.id, allowedTypes: boards.allowedTypes })
    .from(boards)
    .where(and(eq(boards.id, workItemData.boardId), eq(boards.workspaceId, workspaceId)))
    .limit(1);

  if (!boardRow) {
    throw new Error(
      `BOARD_NOT_IN_WORKSPACE: Board "${workItemData.boardId}" does not belong to the active workspace`
    );
  }

  const allowed = boardRow.allowedTypes;
  if (Array.isArray(allowed) && allowed.length > 0) {
    const requestedType = (workItemData.type ?? "task") as WorkItemType;
    if (!allowed.includes(requestedType)) {
      // Prefix for API layers to downgrade this to a 400 without parsing.
      throw new Error(`WORK_ITEM_TYPE_NOT_ALLOWED: Type "${requestedType}" is not allowed on this board`);
    }
  }

  // Block creation inside a completed parent (or any completed ancestor)
  if (data.parentId) {
    const { isCompleted, completedItem } = await isAncestorCompleted(data.parentId, workItemData.boardId);
    if (isCompleted && completedItem) {
      throw new Error(
        `PARENT_COMPLETED: Cannot create a work item inside completed ${completedItem.type} "${completedItem.title}". ` +
        `Create a new item at the board level instead of adding to a completed parent.`
      );
    }

    const { isNotInBacklog, item: notInBacklogItem } = await isParentNotInBacklog(data.parentId, workItemData.boardId);
    if (isNotInBacklog && notInBacklogItem) {
      throw new Error(
        `PARENT_NOT_IN_BACKLOG: Cannot create a child inside ${notInBacklogItem.type} "${notInBacklogItem.title}" because it is not in Backlog. ` +
        `Move the parent back to Backlog before adding children, or create the item at the board level.`
      );
    }
  }

  // If position not provided, set to max position + 1 for that column
  // Parent types (boardColumnId is null) default to position 0
  let position = workItemData.position;
  if (position === undefined || position === null) {
    if (resolvedBoardColumnId) {
      const [maxPos] = await db
        .select({ maxPosition: sql<number>`coalesce(max(${workItems.position}), -1)` })
        .from(workItems)
        .where(eq(workItems.boardColumnId, resolvedBoardColumnId));
      position = (maxPos?.maxPosition ?? -1) + 1;
    } else {
      position = 0;
    }
  }

  // Generate taskId from project initials + sequential number
  let projectName: string | null = null;
  if (workItemData.projectId) {
    const [proj] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, workItemData.projectId), eq(projects.workspaceId, workspaceId)))
      .limit(1);
    if (!proj) {
      throw new Error(
        `PROJECT_NOT_IN_WORKSPACE: Project "${workItemData.projectId}" does not belong to the active workspace`
      );
    }
    projectName = proj.name;
  }
  const prefix = generateProjectPrefix(projectName);
  const taskId = await getNextTaskId(prefix, workItemData.type ?? "task", workspaceId);

  // Insert work item
  const [newItem] = await db
    .insert(workItems)
    .values({
      id: providedId ?? crypto.randomUUID(),
      ...workItemData,
      boardColumnId: resolvedBoardColumnId,
      taskId,
      position,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      priority: workItemData.priority || "medium",
      metadata: workItemData.metadata || {},
    })
    .returning();

  if (!newItem) throw new Error("Failed to create work item");

  // Add tags if provided
  if (tagIds && tagIds.length > 0) {
    await db.insert(workItemTags).values(
      tagIds.map((tagId) => ({
        workItemId: newItem.id,
        tagId,
      }))
    );
  }

  // Auto-assign creator as responsible stakeholder
  if (data.createdByUserId) {
    await db
      .insert(workItemAssignees)
      .values({
        workItemId: newItem.id,
        userId: data.createdByUserId,
        role: "responsible",
      })
      .onConflictDoNothing();
  }

  // Log "created" event
  logEvent({
    workItemId: newItem.id,
    eventType: "created",
    triggeredBy: context.triggeredBy,
    triggeredByUserId: context.triggeredByUserId,
    metadata: {
      title: newItem.title,
      type: newItem.type,
      boardId: newItem.boardId,
      boardColumnId: newItem.boardColumnId,
    },
  });

  return getWorkItemById(newItem.id) as Promise<WorkItemWithRelations>;
};

// Update work item
export const updateWorkItem = async (
  workspaceId: string,
  id: string,
  data: UpdateWorkItemRequest,
  context: TriggeredByContext = defaultTriggeredByContext
): Promise<WorkItemWithRelations | null> => {
  const { startDate, dueDate, tagIds, parentId, ...rest } = data;

  // Fetch current item to detect changes for event logging (org-scoped via board)
  const [currentItem] = await db
    .select()
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .where(and(eq(workItems.id, id), eq(boards.workspaceId, workspaceId)))
    .limit(1)
    .then((rows) => rows.map((r) => r.work_items));

  if (!currentItem) return null;

  const updateData: Record<string, unknown> = {
    ...rest,
    updatedAt: new Date(),
  };

  // Handle startDate explicitly (can be null to clear, string to set, or undefined to skip)
  if (startDate !== undefined) {
    updateData.startDate = startDate ? new Date(startDate) : null;
  }

  // Handle dueDate explicitly (can be null to clear, string to set, or undefined to skip)
  if (dueDate !== undefined) {
    updateData.dueDate = dueDate ? new Date(dueDate) : null;
  }

  // Handle parentId explicitly (can be null to clear, string to set, or undefined to skip)
  if (parentId !== undefined) {
    updateData.parentId = parentId;
  }

  const [updated] = await db
    .update(workItems)
    .set(updateData)
    .where(eq(workItems.id, id))
    .returning();

  if (!updated) return null;

  // Handle tags if provided
  if (tagIds !== undefined) {
    // Delete existing tags
    await db.delete(workItemTags).where(eq(workItemTags.workItemId, id));

    // Insert new tags
    if (tagIds.length > 0) {
      await db.insert(workItemTags).values(
        tagIds.map((tagId) => ({
          workItemId: id,
          tagId,
        }))
      );
    }
  }

  // Log "updated" events for each changed field
  const events: NewWorkItemEvent[] = [];
  const trackableFields = [
    "title",
    "description",
    "type",
    "priority",
    "assignee",
  ] as const;

  for (const field of trackableFields) {
    if (rest[field] !== undefined) {
      const oldVal = currentItem[field];
      const newVal = rest[field];
      if (String(oldVal ?? "") !== String(newVal ?? "")) {
        events.push({
          workItemId: id,
          eventType: "updated",
          fieldName: field,
          oldValue: oldVal != null ? String(oldVal) : null,
          newValue: newVal != null ? String(newVal) : null,
          triggeredBy: context.triggeredBy,
          triggeredByUserId: context.triggeredByUserId,
        });
      }
    }
  }

  // Track startDate changes
  if (startDate !== undefined) {
    const oldStartDate = currentItem.startDate
      ? currentItem.startDate.toISOString()
      : null;
    const newStartDate = startDate ?? null;
    if (oldStartDate !== newStartDate) {
      events.push({
        workItemId: id,
        eventType: "updated",
        fieldName: "startDate",
        oldValue: oldStartDate,
        newValue: newStartDate,
        triggeredBy: context.triggeredBy,
        triggeredByUserId: context.triggeredByUserId,
      });
    }
  }

  // Track dueDate changes
  if (dueDate !== undefined) {
    const oldDueDate = currentItem.dueDate
      ? currentItem.dueDate.toISOString()
      : null;
    const newDueDate = dueDate ?? null;
    if (oldDueDate !== newDueDate) {
      events.push({
        workItemId: id,
        eventType: "updated",
        fieldName: "dueDate",
        oldValue: oldDueDate,
        newValue: newDueDate,
        triggeredBy: context.triggeredBy,
        triggeredByUserId: context.triggeredByUserId,
      });
    }
  }

  // Track parentId changes
  if (parentId !== undefined) {
    const oldParentId = currentItem.parentId;
    if (oldParentId !== parentId) {
      events.push({
        workItemId: id,
        eventType: "updated",
        fieldName: "parentId",
        oldValue: oldParentId,
        newValue: parentId,
        triggeredBy: context.triggeredBy,
        triggeredByUserId: context.triggeredByUserId,
      });
    }
  }

  // Track tag changes
  if (tagIds !== undefined) {
    events.push({
      workItemId: id,
      eventType: "updated",
      fieldName: "tags",
      oldValue: null,
      newValue: tagIds.join(","),
      triggeredBy: context.triggeredBy,
      triggeredByUserId: context.triggeredByUserId,
    });
  }

  logEvents(events);

  return getWorkItemById(id, workspaceId);
};

// Delete work item
// Note: "deleted" event is logged before deletion, but will be cascade-deleted
// along with the work item due to the FK onDelete: cascade constraint.
// The event is still logged for any listeners or audit hooks that process events
// synchronously before the transaction completes.
export const deleteWorkItem = async (
  workspaceId: string,
  id: string,
  context: TriggeredByContext = defaultTriggeredByContext
): Promise<boolean> => {
  // Fetch item info before deleting for the event log (org-scoped via board)
  const [itemToDelete] = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      type: workItems.type,
      boardId: workItems.boardId,
      boardColumnId: workItems.boardColumnId,
    })
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .where(and(eq(workItems.id, id), eq(boards.workspaceId, workspaceId)))
    .limit(1);

  if (!itemToDelete) return false;

  // Log "deleted" event before the actual deletion
  try {
    await db.insert(workItemEvents).values({
      workItemId: id,
      eventType: "deleted",
      triggeredBy: context.triggeredBy,
      triggeredByUserId: context.triggeredByUserId,
      metadata: {
        title: itemToDelete.title,
        type: itemToDelete.type,
        boardId: itemToDelete.boardId,
        boardColumnId: itemToDelete.boardColumnId,
      },
    });
  } catch {
    // Silently ignore event logging errors
  }

  const result = await db
    .delete(workItems)
    .where(eq(workItems.id, id))
    .returning();
  return result.length > 0;
};


// Utility: check if metadata contains incomplete checklist items
export const hasIncompleteChecklist = (
  metadata: Record<string, unknown> | null | undefined
): { hasIncomplete: boolean; uncheckedCount: number; uncheckedItems: string[] } => {
  const empty = { hasIncomplete: false, uncheckedCount: 0, uncheckedItems: [] };
  if (!metadata) return empty;

  // Use deployChecklist (priority) or fall back to userActions
  const raw = metadata.deployChecklist ?? metadata.userActions;
  if (typeof raw !== "string" || raw.trim() === "") return empty;

  const lines = raw.split("\n");
  const uncheckedItems: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Checked items: - [x] or - [X] or * [x] or * [X]
    if (/^[-*]\s*\[(?:x|X)\]\s+/.test(trimmed)) {
      continue;
    }
    // Unchecked items: - [ ] or * [ ] (explicit unchecked checkbox)
    const uncheckedMatch = trimmed.match(/^[-*]\s*\[\s\]\s+(.+)/);
    if (uncheckedMatch) {
      const uncheckedItem = uncheckedMatch[1];
      if (uncheckedItem) {
        uncheckedItems.push(uncheckedItem.trim());
      }
      continue;
    }
    // Plain bullet items without brackets: - text or * text (treated as unchecked)
    const plainBulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (plainBulletMatch) {
      const plainBullet = plainBulletMatch[1];
      if (!plainBullet) {
        continue;
      }
      // Only treat as unchecked if there are no brackets at all
      if (!/^\[/.test(plainBullet)) {
        uncheckedItems.push(plainBullet.trim());
      }
    }
  }

  return {
    hasIncomplete: uncheckedItems.length > 0,
    uncheckedCount: uncheckedItems.length,
    uncheckedItems,
  };
};


// Move work item to a new column and/or position
export const moveWorkItem = async (
  id: string,
  boardColumnId: string,
  position: number,
  context: TriggeredByContext = defaultTriggeredByContext,
  workspaceId?: string
): Promise<boolean> => {
  // Fetch isDone flag + boardId from destination column and current item position/column/metadata
  const currentItemQuery = workspaceId
    ? db
        .select({
          type: workItems.type,
          metadata: workItems.metadata,
          boardId: workItems.boardId,
          boardColumnId: workItems.boardColumnId,
          position: workItems.position,
        })
        .from(workItems)
        .innerJoin(boards, eq(workItems.boardId, boards.id))
        .where(and(eq(workItems.id, id), eq(boards.workspaceId, workspaceId)))
        .limit(1)
    : db
        .select({
          type: workItems.type,
          metadata: workItems.metadata,
          boardId: workItems.boardId,
          boardColumnId: workItems.boardColumnId,
          position: workItems.position,
        })
        .from(workItems)
        .where(eq(workItems.id, id))
        .limit(1);

  const [currentItem] = await currentItemQuery;
  if (!currentItem) return false;

  // Parent-type items (epic/feature/story) have implicit status derived from children.
  // They cannot be moved directly to a board column.
  if (isParentType(currentItem.type as WorkItemType)) {
    throw new Error(
      `PARENT_TYPE_CANNOT_MOVE: Work items of type "${currentItem.type}" cannot be moved directly. Their status is derived from children.`
    );
  }

  let targetBoardColumnId = boardColumnId;
  const areaVirtualMatch = AREA_VIRTUAL_COLUMN_ID_REGEX.exec(boardColumnId);
  if (areaVirtualMatch) {
    const role = areaVirtualMatch[2] as ColumnRole;
    const [columnForRole] = await db
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(and(eq(boardColumns.boardId, currentItem.boardId), eq(boardColumns.role, role)))
      .orderBy(asc(boardColumns.order))
      .limit(1);

    if (!columnForRole) {
      throw new Error(
        `BOARD_COLUMN_ROLE_NOT_FOUND: No column with role "${role}" exists for board "${currentItem.boardId}"`
      );
    }
    targetBoardColumnId = columnForRole.id;
  }

  const [destColumn] = workspaceId
    ? await db
        .select({ isDone: boardColumns.isDone, boardId: boardColumns.boardId })
        .from(boardColumns)
        .innerJoin(boards, eq(boardColumns.boardId, boards.id))
        .where(and(eq(boardColumns.id, targetBoardColumnId), eq(boards.workspaceId, workspaceId)))
        .limit(1)
    : await db
        .select({ isDone: boardColumns.isDone, boardId: boardColumns.boardId })
        .from(boardColumns)
        .where(eq(boardColumns.id, targetBoardColumnId))
        .limit(1);

  if (!destColumn) {
    if (!workspaceId) return false;
    const [columnExists] = await db
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(eq(boardColumns.id, targetBoardColumnId))
      .limit(1);
    if (columnExists) {
      throw new Error(
        `BOARD_COLUMN_NOT_IN_WORKSPACE: Column "${targetBoardColumnId}" does not belong to the active workspace`
      );
    }
    throw new Error(`BOARD_COLUMN_NOT_FOUND: Column "${targetBoardColumnId}" was not found`);
  }

  // Guard: block move to Done when deploy checklist has incomplete items
  if (destColumn.isDone) {
    const checklistResult = hasIncompleteChecklist(currentItem.metadata as Record<string, unknown> | null);
    if (checklistResult.hasIncomplete) {
      const itemsList = checklistResult.uncheckedItems.join(", ");
      throw new Error(
        `INCOMPLETE_CHECKLIST: Cannot move to Done with ${checklistResult.uncheckedCount} unchecked deploy checklist items: [${itemsList}]`
      );
    }
  }

  // Calculate updated metadata with finishedAt
  const currentMetadata = (currentItem.metadata as Record<string, unknown>) ?? {};
  let updatedMetadata: Record<string, unknown>;
  if (destColumn.isDone) {
    updatedMetadata = { ...currentMetadata, finishedAt: new Date().toISOString() };
  } else {
    const { finishedAt: _, ...rest } = currentMetadata;
    updatedMetadata = rest;
  }

  const oldColumnId = currentItem.boardColumnId;
  if (!oldColumnId) return false; // Parent items (epic/feature/story) have no column
  const oldPosition = currentItem.position;
  const isSameColumn = oldColumnId === targetBoardColumnId;

  if (isSameColumn) {
    // Same-column reorder: shift items between old and new positions
    if (oldPosition < position) {
      // Moving down: shift items between (oldPos, newPos] down by 1
      await db
        .update(workItems)
        .set({
          position: sql`${workItems.position} - 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workItems.boardColumnId, targetBoardColumnId),
            sql`${workItems.position} > ${oldPosition}`,
            sql`${workItems.position} <= ${position}`,
            sql`${workItems.id} != ${id}`
          )
        );
    } else if (oldPosition > position) {
      // Moving up: shift items between [newPos, oldPos) up by 1
      await db
        .update(workItems)
        .set({
          position: sql`${workItems.position} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workItems.boardColumnId, targetBoardColumnId),
            sql`${workItems.position} >= ${position}`,
            sql`${workItems.position} < ${oldPosition}`,
            sql`${workItems.id} != ${id}`
          )
        );
    }
  } else {
    // Cross-column move: close gap in source, open space in destination
    await Promise.all([
      // Close gap in source column
      db
        .update(workItems)
        .set({
          position: sql`${workItems.position} - 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workItems.boardColumnId, oldColumnId),
            sql`${workItems.position} > ${oldPosition}`,
            sql`${workItems.id} != ${id}`
          )
        ),
      // Open space in destination column
      db
        .update(workItems)
        .set({
          position: sql`${workItems.position} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workItems.boardColumnId, targetBoardColumnId),
            sql`${workItems.position} >= ${position}`,
            sql`${workItems.id} != ${id}`
          )
        ),
    ]);
  }

  // Move the item with updated metadata (also update boardId for cross-board moves)
  const [updated] = await db
    .update(workItems)
    .set({
      boardId: destColumn.boardId,
      boardColumnId: targetBoardColumnId,
      position,
      metadata: updatedMetadata,
      updatedAt: new Date(),
    })
    .where(eq(workItems.id, id))
    .returning();

  if (!updated) return false;

  // Log "moved" event when column actually changed
  if (oldColumnId !== targetBoardColumnId) {
    logEvent({
      workItemId: id,
      eventType: "moved",
      fieldName: "boardColumnId",
      oldValue: oldColumnId,
      newValue: targetBoardColumnId,
      triggeredBy: context.triggeredBy,
      triggeredByUserId: context.triggeredByUserId,
      metadata: { ...(context.provenance ?? {}) },
    });
  }

  return true;
};

// Change parent of a work item
export const changeParent = async (
  workspaceId: string,
  id: string,
  parentId: string | null,
  context: TriggeredByContext = defaultTriggeredByContext
): Promise<boolean> => {
  // Fetch current parentId for event logging (org-scoped via board)
  const [currentItem] = await db
    .select({ parentId: workItems.parentId })
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .where(and(eq(workItems.id, id), eq(boards.workspaceId, workspaceId)))
    .limit(1);

  if (!currentItem) return false;

  const [updated] = await db
    .update(workItems)
    .set({
      parentId,
      updatedAt: new Date(),
    })
    .where(eq(workItems.id, id))
    .returning();

  if (!updated) return false;

  // Log "updated" event for parent change
  const oldParentId = currentItem?.parentId ?? null;
  if (oldParentId !== parentId) {
    logEvent({
      workItemId: id,
      eventType: "updated",
      fieldName: "parentId",
      oldValue: oldParentId,
      newValue: parentId,
      triggeredBy: context.triggeredBy,
      triggeredByUserId: context.triggeredByUserId,
    });
  }

  return true;
};

// Filters for board Kanban view
export interface WorkItemBoardFilters {
  search?: string;
  type?: WorkItemType;
  priority?: Priority;
  assignee?: string;
  projectId?: string;
  tagIds?: string; // comma-separated tag IDs
  sprintId?: string;
}

// Build a map of item ID -> ancestor chain (parent, grandparent, great-grandparent)
// Uses batch queries instead of N+1 individual lookups
const buildAncestryMap = async (
  items: { id: string; parentId: string | null }[]
): Promise<Map<string, AncestorInfo[]>> => {
  const ancestryMap = new Map<string, AncestorInfo[]>();

  // Initialize: map each item to its chain (starting empty)
  const itemParentIds = new Map<string, string>();
  for (const item of items) {
    ancestryMap.set(item.id, []);
    if (item.parentId) {
      itemParentIds.set(item.id, item.parentId);
    }
  }

  // Iteratively resolve up to 3 levels of ancestors
  let currentLookups = itemParentIds; // itemId -> parentId to resolve
  for (let level = 0; level < 3 && currentLookups.size > 0; level++) {
    // Collect unique parent IDs to fetch
    const parentIdsToFetch = [...new Set(currentLookups.values())];
    if (parentIdsToFetch.length === 0) break;

    // Batch fetch all parents in a single query
    const parents = await db
      .select({
        id: workItems.id,
        title: workItems.title,
        type: workItems.type,
        taskId: workItems.taskId,
        parentId: workItems.parentId,
      })
      .from(workItems)
      .where(inArray(workItems.id, parentIdsToFetch));

    const parentMap = new Map(parents.map((p) => [p.id, p]));

    // Next level lookups: for each resolved parent that has its own parent
    const nextLookups = new Map<string, string>();

    for (const [itemId, parentId] of currentLookups) {
      const parent = parentMap.get(parentId);
      if (parent) {
        const chain = ancestryMap.get(itemId)!;
        chain.push({
          id: parent.id,
          title: parent.title,
          type: parent.type as WorkItemType,
          taskId: parent.taskId,
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

/**
 * For each parent work item (boardColumnId = NULL), compute which board column
 * it should virtually appear in based on the progress of its leaf descendants.
 *
 * Algorithm:
 *  - Walks up to 3 levels deep (epic→feature→story→task) to find leaf items
 *    (items with a boardColumnId set). Intermediate items (boardColumnId=NULL)
 *    are descended into.
 *  - Includes archived children — virtual status reflects all descendants.
 *  - No leaf descendants -> backlog column
 *  - All leaves in a "done" column -> done column
 *  - Otherwise -> column of the least advanced leaf (lowest order)
 *
 * Uses batch queries per level (no N+1).
 * Returns a Map from parent work item ID -> virtual board column ID.
 */
export const computeVirtualColumns = async (
  parentIds: string[],
  columns: { id: string; order: number; role: string; isDone: boolean }[]
): Promise<{ virtualColumnMap: Map<string, string>; childrenSummaries: Map<string, ChildrenSummary> }> => {
  const emptyResult = { virtualColumnMap: new Map<string, string>(), childrenSummaries: new Map<string, ChildrenSummary>() };
  if (parentIds.length === 0) return emptyResult;

  // Track leaf items (columnId + itemId) per original parent
  const leafEntriesByParent = new Map<string, { columnId: string; itemId: string }[]>();
  // Track userActions from all descendants per original parent
  const userActionsByParent = new Map<string, {
    itemId: string;
    taskId: string | null;
    userActions: string;
    validationChecks?: string;
    documentationNotes?: string;
    isDeployChecklist?: boolean;
  }[]>();
  const humanActionRequirementsByParent = new Map<string, {
    itemId: string;
    taskId: string | null;
    message: string;
    externalValidationRequired?: boolean;
    externalValidationTools?: string[];
  }[]>();
  // Track estimated points from all descendants per original parent
  const estimatedPointsByParent = new Map<string, number>();
  for (const pid of parentIds) {
    leafEntriesByParent.set(pid, []);
    userActionsByParent.set(pid, []);
    humanActionRequirementsByParent.set(pid, []);
    estimatedPointsByParent.set(pid, 0);
  }

  // currentToOriginal: maps a current-level item ID -> the original parentId it belongs to
  let currentToOriginal = new Map<string, string>(
    parentIds.map((id) => [id, id])
  );

  // Walk up to 3 levels deep (epic→feature→story→task)
  for (let level = 0; level < 3 && currentToOriginal.size > 0; level++) {
    const currentIds = [...currentToOriginal.keys()];

    const children = await db
      .select({
        parentId: workItems.parentId,
        id: workItems.id,
        boardColumnId: workItems.boardColumnId,
        metadata: workItems.metadata,
        taskId: workItems.taskId,
      })
      .from(workItems)
      .where(and(inArray(workItems.parentId, currentIds), isNull(workItems.archivedAt)));

    const nextLevel = new Map<string, string>();

    for (const child of children) {
      if (!child.parentId) continue;
      const originalParent = currentToOriginal.get(child.parentId);
      if (!originalParent) continue;

      // Collect implementation outcomes (deployChecklist, validationChecks, documentationNotes) from any descendant
      const meta = child.metadata as Record<string, unknown> | null;
      const dc = meta?.deployChecklist;
      const ua = meta?.userActions;
      const dod = meta?.definitionOfDone;
      const vc = meta?.validationChecks;
      const dn = meta?.documentationNotes;
      const actions = typeof dc === "string" && dc.trim().length > 0
        ? dc.trim()
        : typeof ua === "string" && ua.trim().length > 0
          ? ua.trim()
          : typeof dod === "string" && dod.trim().length > 0
            ? dod.trim()
            : null;
      const validationChecks = typeof vc === "string" && vc.trim().length > 0 ? vc.trim() : undefined;
      const documentationNotes = typeof dn === "string" && dn.trim().length > 0 ? dn.trim() : undefined;
      if (actions || validationChecks || documentationNotes) {
        userActionsByParent.get(originalParent)!.push({
          itemId: child.id,
          taskId: child.taskId,
          userActions: actions ?? "",
          ...(validationChecks ? { validationChecks } : {}),
          ...(documentationNotes ? { documentationNotes } : {}),
          isDeployChecklist: typeof dc === "string" && dc.trim().length > 0,
        });
      }

      if (hasDodHumanActionRequirement(meta)) {
        const externalValidationTools = getStringListMetadata(meta, "dod_external_validation_tools");
        const externalValidationRequired =
          meta?.dod_external_validation_required === true || externalValidationTools.length > 0;
        humanActionRequirementsByParent.get(originalParent)!.push({
          itemId: child.id,
          taskId: child.taskId,
          message: getNonEmptyStringMetadata(meta, [
            "dod_external_validation_reason",
            "dod_human_action",
            "dod_human_action_reason",
            "dod_human_review_reason",
            "userActions",
            "dod_report",
          ]) ?? "Human intervention is required before this item can be remediated automatically.",
          ...(externalValidationRequired ? { externalValidationRequired } : {}),
          ...(externalValidationTools.length > 0 ? { externalValidationTools } : {}),
        });
      }

      // Accumulate estimated points from descendants
      const ep = meta?.estimatedPoints;
      if (typeof ep === "number" && ep > 0) {
        estimatedPointsByParent.set(
          originalParent,
          (estimatedPointsByParent.get(originalParent) ?? 0) + ep
        );
      }

      if (child.boardColumnId) {
        // Leaf node — has a board column assignment
        leafEntriesByParent.get(originalParent)!.push({ columnId: child.boardColumnId, itemId: child.id });
      } else {
        // Intermediate node (parent type, no boardColumnId) — descend
        nextLevel.set(child.id, originalParent);
      }
    }

    currentToOriginal = nextLevel;
  }

  // Batch-fetch assignees for all leaf items across all parents
  const allLeafIds = new Set<string>();
  for (const entries of leafEntriesByParent.values()) {
    for (const entry of entries) {
      allLeafIds.add(entry.itemId);
    }
  }
  const assigneesByLeafId = allLeafIds.size > 0
    ? await getAssigneesByWorkItemIds([...allLeafIds])
    : new Map<string, { user: { id: string; name: string; email: string; image: string | null } }[]>();

  // Build column order lookup and find special columns
  const columnOrder = new Map(columns.map((c) => [c.id, c.order]));
  const columnIsDone = new Map(columns.map((c) => [c.id, c.isDone]));
  const backlogColumn = columns.find((c) => c.role === "backlog") ?? columns[0];
  const doneColumn = columns.find((c) => c.isDone);

  const virtualColumnMap = new Map<string, string>();
  const childrenSummaries = new Map<string, ChildrenSummary>();

  for (const parentId of parentIds) {
    const leafEntries = leafEntriesByParent.get(parentId) ?? [];

    // Build children summary
    const countPerColumn: Record<string, number> = {};
    const leafIdsByColumn: Record<string, string[]> = {};
    let doneCount = 0;

    for (const entry of leafEntries) {
      countPerColumn[entry.columnId] = (countPerColumn[entry.columnId] ?? 0) + 1;
      if (!leafIdsByColumn[entry.columnId]) {
        leafIdsByColumn[entry.columnId] = [];
      }
      leafIdsByColumn[entry.columnId]!.push(entry.itemId);
      if (columnIsDone.get(entry.columnId) === true) {
        doneCount++;
      }
    }

    const totalLeafCount = leafEntries.length;
    const progressPercent = totalLeafCount > 0 ? Math.round((doneCount / totalLeafCount) * 100) : 0;

    const childUserActions = userActionsByParent.get(parentId) ?? [];
    const childHumanActionRequirements = humanActionRequirementsByParent.get(parentId) ?? [];

    // Aggregate unique assignees from all leaf items of this parent
    const seenUserIds = new Set<string>();
    const aggregatedAssignees: { id: string; name: string; email: string; image: string | null }[] = [];
    for (const entry of leafEntries) {
      const assignees = assigneesByLeafId.get(entry.itemId);
      if (assignees) {
        for (const a of assignees) {
          if (!seenUserIds.has(a.user.id)) {
            seenUserIds.add(a.user.id);
            aggregatedAssignees.push({
              id: a.user.id,
              name: a.user.name,
              email: a.user.email,
              image: a.user.image,
            });
          }
        }
      }
    }

    const totalEstimatedPoints = estimatedPointsByParent.get(parentId) ?? 0;

    childrenSummaries.set(parentId, {
      totalLeafCount,
      doneCount,
      progressPercent,
      countPerColumn,
      leafIdsByColumn,
      ...(childUserActions.length > 0 ? { childUserActions } : {}),
      ...(childHumanActionRequirements.length > 0 ? { childHumanActionRequirements } : {}),
      ...(aggregatedAssignees.length > 0 ? { aggregatedAssignees } : {}),
      ...(totalEstimatedPoints > 0 ? { totalEstimatedPoints } : {}),
    });

    // Compute virtual column
    if (totalLeafCount === 0) {
      // No active leaf descendants — skip (parent is either empty or fully archived)
      continue;
    }

    const leafColumnIds = leafEntries.map((e) => e.columnId);

    // Check if ALL leaves are in a done column
    const allDone = leafColumnIds.every((cId) => columnIsDone.get(cId) === true);

    if (allDone && doneColumn) {
      virtualColumnMap.set(parentId, doneColumn.id);
      continue;
    }

    // Find the least advanced leaf (lowest column order)
    let minOrder = Infinity;
    let minColumnId = backlogColumn?.id;
    for (const cId of leafColumnIds) {
      const order = columnOrder.get(cId);
      if (order !== undefined && order < minOrder) {
        minOrder = order;
        minColumnId = cId;
      }
    }
    if (minColumnId) virtualColumnMap.set(parentId, minColumnId);
  }

  return { virtualColumnMap, childrenSummaries };
};


/**
 * Selective projection for board/area queries.
 * Includes all columns except replaces `description` with a truncated
 * 200-character preview via SQL LEFT() to reduce payload size.
 * The full description is only needed in detail views, not card listings.
 */
const workItemBoardSelect = {
  id: workItems.id,
  projectId: workItems.projectId,
  boardId: workItems.boardId,
  boardColumnId: workItems.boardColumnId,
  parentId: workItems.parentId,
  type: workItems.type,
  title: workItems.title,
  description: sql<string | null>`left(${workItems.description}, 200)`.as("description"),
  priority: workItems.priority,
  assignee: workItems.assignee,
  position: workItems.position,
  startDate: workItems.startDate,
  dueDate: workItems.dueDate,
  estimatedHours: workItems.estimatedHours,
  metadata: workItems.metadata,
  isAiProcessing: workItems.isAiProcessing,
  taskId: workItems.taskId,
  createdByUserId: workItems.createdByUserId,
  archivedAt: workItems.archivedAt,
  createdAt: workItems.createdAt,
  updatedAt: workItems.updatedAt,
};

const workItemBoardSelectFallback = {
  ...workItemBoardSelect,
  description: sql<string | null>`NULL`.as("description"),
};
// Get work items grouped by board columns (for Kanban view)
export const getWorkItemsByBoard = async (
  workspaceId: string,
  boardId: string,
  filters?: WorkItemBoardFilters
): Promise<WorkItemsByColumn[]> => {
  const [boardAccess] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.workspaceId, workspaceId)))
    .limit(1);

  if (!boardAccess) return [];

  // Query 1: Get all columns for the board
  const columnsResult = await db
    .select()
    .from(boardColumns)
    .where(eq(boardColumns.boardId, boardId))
    .orderBy(asc(boardColumns.order));

  // Query 2: Single query for ALL items in the board (replaces M per-column queries)
  const conditions = [
    eq(workItems.boardId, boardId),
    isNull(workItems.archivedAt),
    buildWorkspaceScopedProjectCondition(workspaceId),
  ];

  if (filters?.search) {
    conditions.push(
      or(
        ilike(workItems.title, `%${filters.search}%`),
        ilike(workItems.description, `%${filters.search}%`),
        ilike(workItems.taskId, `%${filters.search}%`)
      )!
    );
  }
  if (filters?.type) {
    conditions.push(eq(workItems.type, filters.type));
  }
  if (filters?.priority) {
    conditions.push(eq(workItems.priority, filters.priority));
  }
  if (filters?.assignee) {
    conditions.push(ilike(workItems.assignee, `%${filters.assignee}%`));
  }
  if (filters?.projectId) {
    conditions.push(eq(workItems.projectId, filters.projectId));
  }
  if (filters?.tagIds) {
    const tagIdList = filters.tagIds.split(",");
    conditions.push(
      inArray(
        workItems.id,
        db
          .select({ workItemId: workItemTags.workItemId })
          .from(workItemTags)
          .where(inArray(workItemTags.tagId, tagIdList))
      )
    );
  }
  if (filters?.sprintId) {
    conditions.push(
      inArray(
        workItems.id,
        db
          .select({ workItemId: sprintWorkItems.workItemId })
          .from(sprintWorkItems)
          .where(eq(sprintWorkItems.sprintId, filters.sprintId))
      )
    );
  }

  const allItems = await (async () => {
    try {
      return await db
        .select(workItemBoardSelect)
        .from(workItems)
        .where(and(...conditions))
        .orderBy(asc(workItems.position), asc(workItems.createdAt));
    } catch (error) {
      if (!isInvalidUtf8QueryError(error)) throw error;
      return db
        .select(workItemBoardSelectFallback)
        .from(workItems)
        .where(and(...conditions))
        .orderBy(asc(workItems.position), asc(workItems.createdAt));
    }
  })();

  // Separate leaf items (have boardColumnId) and parent items (null boardColumnId)
  const itemsByColumnId = new Map<string, (typeof allItems)>();
  const parentItems: typeof allItems = [];

  for (const item of allItems) {
    if (!item.boardColumnId) {
      parentItems.push(item);
      continue;
    }
    const list = itemsByColumnId.get(item.boardColumnId);
    if (list) {
      list.push(item);
    } else {
      itemsByColumnId.set(item.boardColumnId, [item]);
    }
  }

  // Compute virtual columns for parent items and place them into columns
  const columnsMeta = columnsResult.map((c) => ({
    id: c.id,
    order: c.order,
    role: (c.role ?? "other") as string,
    isDone: c.isDone ?? false,
  }));
  const { virtualColumnMap, childrenSummaries } = await computeVirtualColumns(
    parentItems.map((p) => p.id),
    columnsMeta
  );

  // Track which items are virtually placed (parent types)
  const virtualItemIds = new Set<string>();
  for (const parent of parentItems) {
    const virtualColId = virtualColumnMap.get(parent.id);
    if (!virtualColId) continue;
    virtualItemIds.add(parent.id);
    const list = itemsByColumnId.get(virtualColId);
    if (list) list.push(parent);
    else itemsByColumnId.set(virtualColId, [parent]);
  }

  if (allItems.length === 0) {
    // No items — return empty columns
    return columnsResult.map((column) => ({
      column: {
        id: column.id,
        boardId: column.boardId,
        name: column.name,
        color: column.color,
        order: column.order,
        role: column.role,
        isDone: column.isDone ?? false,
        createdAt: column.createdAt,
        updatedAt: column.updatedAt,
      },
      items: [],
      count: 0,
    }));
  }

  const allItemIds = allItems.map((i) => i.id);
  const uniqueProjectIds = [...new Set(allItems.map((i) => i.projectId).filter(Boolean))] as string[];
  const uniqueCreatorIds = [...new Set(allItems.map((i) => i.createdByUserId).filter(Boolean))] as string[];

  // Batch queries 3-8 in parallel: ancestry, tags, childrenCounts, projects, assignees, creators
  const [ancestryMap, batchTags, batchChildrenCounts, batchProjects, boardAssigneesMap, creatorsResult] = await Promise.all([
    // Ancestry (already batched internally, ~3 queries max)
    buildAncestryMap(allItems.map((item) => ({ id: item.id, parentId: item.parentId }))),
    // Tags for all items in one query
    db
      .select({
        workItemId: workItemTags.workItemId,
        id: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(workItemTags)
      .innerJoin(tags, eq(workItemTags.tagId, tags.id))
      .where(inArray(workItemTags.workItemId, allItemIds)),
    // Children counts for all items in one query
    db
      .select({
        parentId: workItems.parentId,
        count: sql<number>`count(*)::int`,
      })
      .from(workItems)
      .where(inArray(workItems.parentId, allItemIds))
      .groupBy(workItems.parentId),
    // Projects
    uniqueProjectIds.length > 0
      ? db
          .select({ id: projects.id, name: projects.name, color: projects.color })
          .from(projects)
          .where(inArray(projects.id, uniqueProjectIds))
      : Promise.resolve([]),
    // Assignees (batch query)
    getAssigneesByWorkItemIds(allItemIds),
    // Creators
    uniqueCreatorIds.length > 0
      ? db
          .select({ id: user.id, name: user.name, image: user.image })
          .from(user)
          .where(inArray(user.id, uniqueCreatorIds))
      : Promise.resolve([]),
  ]);

  // Build lookup maps
  const tagsMap = new Map<string, { id: string; name: string; color: string | null }[]>();
  for (const tag of batchTags) {
    const list = tagsMap.get(tag.workItemId);
    if (list) {
      list.push({ id: tag.id, name: tag.name, color: tag.color });
    } else {
      tagsMap.set(tag.workItemId, [{ id: tag.id, name: tag.name, color: tag.color }]);
    }
  }
  const childrenCountMap = new Map(batchChildrenCounts.map((c) => [c.parentId, c.count]));
  const projectMap = new Map(batchProjects.map((p) => [p.id, p]));
  const creatorMap = new Map(creatorsResult.map((c) => [c.id, c]));

  // Assemble result per column
  return columnsResult.map((column) => {
    const itemsInColumn = itemsByColumnId.get(column.id) ?? [];

    const itemsWithContext = itemsInColumn.map((item) => {
      const ancestors = ancestryMap.get(item.id) ?? [];
      const project = item.projectId ? projectMap.get(item.projectId) : undefined;

      return {
        ...item,
        isVirtualColumn: virtualItemIds.has(item.id),
        tags: tagsMap.get(item.id) ?? [],
        assignees: boardAssigneesMap.get(item.id) ?? [],
        childrenCount: childrenCountMap.get(item.id) ?? 0,
        parentTitle: ancestors[0]?.title ?? null,
        parentType: ancestors[0]?.type ?? null,
        parentTaskId: ancestors[0]?.taskId ?? null,
        ancestors: ancestors.length > 0 ? ancestors : undefined,
        projectName: project?.name ?? null,
        projectColor: project?.color ?? null,
        createdBy: (() => {
          const creator = item.createdByUserId ? creatorMap.get(item.createdByUserId) ?? null : null;
          return creator ? { id: creator.id, name: creator.name, image: creator.image } : null;
        })(),
        childrenSummary: childrenSummaries.get(item.id),
      };
    });

    return {
      column: {
        id: column.id,
        boardId: column.boardId,
        name: column.name,
        color: column.color,
        order: column.order,
        role: column.role,
        isDone: column.isDone ?? false,
        createdAt: column.createdAt,
        updatedAt: column.updatedAt,
      },
      items: itemsWithContext as unknown as WorkItemWithContext[],
      count: itemsWithContext.length,
    };
  });
};

// Canonical order for column roles used by the area-wide Kanban view
const ROLE_CANONICAL_ORDER: Record<ColumnRole, number> = {
  backlog: 0,
  in_progress: 1,
  review: 2,
  validating: 3,
  release: 4,
  done: 5,
  todo: 90,
  needs_fix: 91,
  to_document: 92,
  testing: 93,
  other: 99,
};

/**
 * Get work items from ALL boards of a given area, normalized by column role.
 *
 * All boards within the same area share the same set of column roles, so
 * we merge items across boards into virtual "role columns".  The first
 * column encountered for each role provides the representative column
 * metadata (name, color, etc.).
 */
export const getWorkItemsByArea = async (
  workspaceId: string,
  area: BoardArea,
  filters?: WorkItemBoardFilters
): Promise<WorkItemsByColumn[]> => {
  // 1. Get all board IDs for the area (filtered by workspace directly)
  const areaBoards = await db
    .select({ id: boards.id })
    .from(boards)
    .where(
      and(
        eq(boards.area, area),
        eq(boards.workspaceId, workspaceId)
      )
    )
    .orderBy(asc(boards.createdAt));

  if (areaBoards.length === 0) return [];

  const boardIds = areaBoards.map((b) => b.id);

  // 2. Get all columns across those boards, ordered by board then order
  const allColumns = await db
    .select()
    .from(boardColumns)
    .where(inArray(boardColumns.boardId, boardIds))
    .orderBy(asc(boardColumns.order));

  // 3. Build normalized role -> representative column map
  //    First column per role wins (provides metadata for the virtual column)
  const roleColumnMap = new Map<
    ColumnRole,
    { column: BoardColumn; columnIds: string[] }
  >();

  for (const col of allColumns) {
    const role = (col.role ?? "other") as ColumnRole;
    const existing = roleColumnMap.get(role);
    if (existing) {
      existing.columnIds.push(col.id);
    } else {
      roleColumnMap.set(role, {
        column: {
          id: `area-${area}-${role}`,
          boardId: col.boardId,
          name: col.name,
          color: col.color,
          order: ROLE_CANONICAL_ORDER[role] ?? 99,
          role: role,
          isDone: col.isDone ?? false,
          createdAt: col.createdAt,
          updatedAt: col.updatedAt,
        },
        columnIds: [col.id],
      });
    }
  }

  // Column IDs grouped by role for filtering work items
  const allColumnIds = allColumns.map((c) => c.id);
  // Map from real column ID -> role for grouping
  const columnIdToRole = new Map<string, ColumnRole>();
  for (const col of allColumns) {
    columnIdToRole.set(col.id, (col.role ?? "other") as ColumnRole);
  }

  // 4. Query work items across all boards in the area
  const conditions = [
    inArray(workItems.boardId, boardIds),
    isNull(workItems.archivedAt),
    buildWorkspaceScopedProjectCondition(workspaceId),
  ];

  if (filters?.search) {
    conditions.push(
      or(
        ilike(workItems.title, `%${filters.search}%`),
        ilike(workItems.description, `%${filters.search}%`),
        ilike(workItems.taskId, `%${filters.search}%`)
      )!
    );
  }
  if (filters?.type) {
    conditions.push(eq(workItems.type, filters.type));
  }
  if (filters?.priority) {
    conditions.push(eq(workItems.priority, filters.priority));
  }
  if (filters?.assignee) {
    conditions.push(ilike(workItems.assignee, `%${filters.assignee}%`));
  }
  if (filters?.projectId) {
    conditions.push(eq(workItems.projectId, filters.projectId));
  }
  if (filters?.tagIds) {
    const tagIdList = filters.tagIds.split(",");
    conditions.push(
      inArray(
        workItems.id,
        db
          .select({ workItemId: workItemTags.workItemId })
          .from(workItemTags)
          .where(inArray(workItemTags.tagId, tagIdList))
      )
    );
  }

  const allItems = await (async () => {
    try {
      return await db
        .select(workItemBoardSelect)
        .from(workItems)
        .where(and(...conditions))
        .orderBy(asc(workItems.position), asc(workItems.createdAt));
    } catch (error) {
      if (!isInvalidUtf8QueryError(error)) throw error;
      return db
        .select(workItemBoardSelectFallback)
        .from(workItems)
        .where(and(...conditions))
        .orderBy(asc(workItems.position), asc(workItems.createdAt));
    }
  })();

  // 5. Separate leaf items (have boardColumnId) and parent items (null boardColumnId)
  const itemsByRole = new Map<ColumnRole, (typeof allItems)>();
  const areaParentItems: typeof allItems = [];

  for (const item of allItems) {
    if (!item.boardColumnId) {
      areaParentItems.push(item);
      continue;
    }
    const role = columnIdToRole.get(item.boardColumnId) ?? "other";
    const list = itemsByRole.get(role);
    if (list) {
      list.push(item);
    } else {
      itemsByRole.set(role, [item]);
    }
  }

  // Compute virtual columns for parent items using their board's columns,
  // then map virtual column ID back to a role for grouping
  const areaVirtualItemIds = new Set<string>();
  const areaChildrenSummaries = new Map<string, ChildrenSummary>();
  if (areaParentItems.length > 0) {
    // Group parents by boardId so we can compute virtual columns per board
    const parentsByBoardId = new Map<string, typeof areaParentItems>();
    for (const p of areaParentItems) {
      const list = parentsByBoardId.get(p.boardId);
      if (list) list.push(p);
      else parentsByBoardId.set(p.boardId, [p]);
    }

    // Compute virtual columns for each board's parents in parallel
    const boardColumnsByBoardId = new Map<string, typeof allColumns>();
    for (const col of allColumns) {
      const list = boardColumnsByBoardId.get(col.boardId);
      if (list) list.push(col);
      else boardColumnsByBoardId.set(col.boardId, [col]);
    }

    const virtualPromises = [...parentsByBoardId.entries()].map(
      ([bId, parents]) => {
        const cols = (boardColumnsByBoardId.get(bId) ?? []).map((c) => ({
          id: c.id,
          order: c.order,
          role: (c.role ?? "other") as string,
          isDone: c.isDone ?? false,
        }));
        return computeVirtualColumns(
          parents.map((p) => p.id),
          cols
        );
      }
    );
    const virtualResults = await Promise.all(virtualPromises);

    // Build a lookup map for parent items by ID for O(1) access
    const parentItemById = new Map(areaParentItems.map((p) => [p.id, p]));

    // Merge all virtual maps and children summaries, and place parents into role groups
    for (const { virtualColumnMap: vMap, childrenSummaries: cSummaries } of virtualResults) {
      for (const [parentId, virtualColId] of vMap) {
        areaVirtualItemIds.add(parentId);
        const role = columnIdToRole.get(virtualColId) ?? "other";
        const parent = parentItemById.get(parentId);
        if (!parent) continue;
        const list = itemsByRole.get(role);
        if (list) list.push(parent);
        else itemsByRole.set(role, [parent]);
      }
      for (const [parentId, summary] of cSummaries) {
        // Remap leafIdsByColumn and countPerColumn from real board column IDs
        // to area virtual column IDs so the frontend can match them
        const remappedLeafIds: Record<string, string[]> = {};
        const remappedCounts: Record<string, number> = {};
        for (const [realColId, leafIds] of Object.entries(summary.leafIdsByColumn)) {
          const role = columnIdToRole.get(realColId) ?? "other";
          const areaColId = `area-${area}-${role}`;
          if (!remappedLeafIds[areaColId]) remappedLeafIds[areaColId] = [];
          remappedLeafIds[areaColId].push(...leafIds);
          remappedCounts[areaColId] = (remappedCounts[areaColId] ?? 0) + (summary.countPerColumn[realColId] ?? 0);
        }
        areaChildrenSummaries.set(parentId, {
          ...summary,
          leafIdsByColumn: remappedLeafIds,
          countPerColumn: remappedCounts,
        });
      }
    }
  }

  // 6. If no items, return empty role columns
  if (allItems.length === 0) {
    const sortedRoles = [...roleColumnMap.entries()].sort(
      (a, b) => (ROLE_CANONICAL_ORDER[a[0]] ?? 99) - (ROLE_CANONICAL_ORDER[b[0]] ?? 99)
    );
    return sortedRoles.map(([, entry]) => ({
      column: entry.column,
      items: [],
      count: 0,
    }));
  }

  // 7. Batch-load relations (same pattern as getWorkItemsByBoard)
  const allItemIds = allItems.map((i) => i.id);
  const uniqueProjectIds = [...new Set(allItems.map((i) => i.projectId).filter(Boolean))] as string[];
  const uniqueCreatorIds = [...new Set(allItems.map((i) => i.createdByUserId).filter(Boolean))] as string[];

  const [ancestryMap, batchTags, batchChildrenCounts, batchProjects, boardAssigneesMap, creatorsResult] = await Promise.all([
    buildAncestryMap(allItems.map((item) => ({ id: item.id, parentId: item.parentId }))),
    db
      .select({
        workItemId: workItemTags.workItemId,
        id: tags.id,
        name: tags.name,
        color: tags.color,
      })
      .from(workItemTags)
      .innerJoin(tags, eq(workItemTags.tagId, tags.id))
      .where(inArray(workItemTags.workItemId, allItemIds)),
    db
      .select({
        parentId: workItems.parentId,
        count: sql<number>`count(*)::int`,
      })
      .from(workItems)
      .where(inArray(workItems.parentId, allItemIds))
      .groupBy(workItems.parentId),
    uniqueProjectIds.length > 0
      ? db
          .select({ id: projects.id, name: projects.name, color: projects.color })
          .from(projects)
          .where(inArray(projects.id, uniqueProjectIds))
      : Promise.resolve([]),
    getAssigneesByWorkItemIds(allItemIds),
    // Creators
    uniqueCreatorIds.length > 0
      ? db
          .select({ id: user.id, name: user.name, image: user.image })
          .from(user)
          .where(inArray(user.id, uniqueCreatorIds))
      : Promise.resolve([]),
  ]);

  // Build lookup maps
  const tagsMap = new Map<string, { id: string; name: string; color: string | null }[]>();
  for (const tag of batchTags) {
    const list = tagsMap.get(tag.workItemId);
    if (list) {
      list.push({ id: tag.id, name: tag.name, color: tag.color });
    } else {
      tagsMap.set(tag.workItemId, [{ id: tag.id, name: tag.name, color: tag.color }]);
    }
  }
  const childrenCountMap = new Map(batchChildrenCounts.map((c) => [c.parentId, c.count]));
  const projectMap = new Map(batchProjects.map((p) => [p.id, p]));
  const creatorMap = new Map(creatorsResult.map((c) => [c.id, c]));

  // 8. Assemble result per role column, sorted by canonical order
  const sortedRoles = [...roleColumnMap.entries()].sort(
    (a, b) => (ROLE_CANONICAL_ORDER[a[0]] ?? 99) - (ROLE_CANONICAL_ORDER[b[0]] ?? 99)
  );

  return sortedRoles.map(([role, entry]) => {
    const itemsInRole = itemsByRole.get(role) ?? [];

    const itemsWithContext = itemsInRole.map((item) => {
      const ancestors = ancestryMap.get(item.id) ?? [];
      const project = item.projectId ? projectMap.get(item.projectId) : undefined;

      return {
        ...item,
        isVirtualColumn: areaVirtualItemIds.has(item.id),
        tags: tagsMap.get(item.id) ?? [],
        assignees: boardAssigneesMap.get(item.id) ?? [],
        childrenCount: childrenCountMap.get(item.id) ?? 0,
        parentTitle: ancestors[0]?.title ?? null,
        parentType: ancestors[0]?.type ?? null,
        parentTaskId: ancestors[0]?.taskId ?? null,
        ancestors: ancestors.length > 0 ? ancestors : undefined,
        projectName: project?.name ?? null,
        projectColor: project?.color ?? null,
        createdBy: (() => {
          const creator = item.createdByUserId ? creatorMap.get(item.createdByUserId) ?? null : null;
          return creator ? { id: creator.id, name: creator.name, image: creator.image } : null;
        })(),
        childrenSummary: areaChildrenSummaries.get(item.id),
      };
    });

    return {
      column: entry.column,
      items: itemsWithContext as unknown as WorkItemWithContext[],
      count: itemsWithContext.length,
    };
  });
};

// Get direct children of a work item
export const getWorkItemHierarchy = async (
  workspaceId: string,
  parentId: string
): Promise<WorkItemWithRelations[]> => {
  const children = await db
    .select({ item: workItems })
    .from(workItems)
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(and(eq(workItems.parentId, parentId), eq(projects.workspaceId, workspaceId)))
    .orderBy(asc(workItems.position), asc(workItems.createdAt));

  return batchHydrateWorkItemRelations(children.map((r) => r.item));
};

/**
 * Recursively resolve all non-archived leaf task IDs under a given parent
 * work item. A "leaf task" is a work item of type 'task' that has no
 * children of its own. Returns an empty array if the parent is not
 * reachable within the workspace scope.
 *
 * Used by runner-implement completion gates (INV-4) to know which work
 * items the job was expected to complete.
 */
export const getLeafTaskIdsUnder = async (
  workspaceId: string,
  rootWorkItemId: string
): Promise<string[]> => {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE descendants AS (
      SELECT wi.id, wi.type, wi.archived_at, wi.parent_id
      FROM work_items wi
      INNER JOIN projects p ON wi.project_id = p.id
      WHERE wi.id = ${rootWorkItemId}
        AND p.workspace_id = ${workspaceId}
      UNION ALL
      SELECT child.id, child.type, child.archived_at, child.parent_id
      FROM work_items child
      INNER JOIN descendants d ON child.parent_id = d.id
    )
    SELECT d.id
    FROM descendants d
    WHERE d.archived_at IS NULL
      AND d.type = 'task'
      AND NOT EXISTS (
        SELECT 1 FROM work_items c WHERE c.parent_id = d.id
      )
  `);

  const raw = (rows as unknown as { rows?: Array<{ id: string }> }).rows ?? (rows as unknown as Array<{ id: string }>);
  return Array.isArray(raw) ? raw.map((r) => r.id) : [];
};

// Bulk move work items to a new column
export const bulkMoveWorkItems = async (
  workspaceId: string,
  workItemIds: string[],
  boardColumnId: string
): Promise<boolean> => {
  if (workItemIds.length === 0) return false;

  const now = new Date();

  // Fetch current items to update their metadata and resolve destination by board when needed (org-scoped via board)
  const allItems = await db
    .select({ id: workItems.id, taskId: workItems.taskId, type: workItems.type, boardId: workItems.boardId, metadata: workItems.metadata })
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .where(and(inArray(workItems.id, workItemIds), eq(boards.workspaceId, workspaceId)));

  // Filter out parent-type items (epic/feature/story) - they have implicit status
  const currentItems = allItems.filter(
    (item) => !isParentType(item.type as WorkItemType)
  );

  if (currentItems.length === 0) return false;

  const areaVirtualMatch = AREA_VIRTUAL_COLUMN_ID_REGEX.exec(boardColumnId);
  const destinationByBoardId = new Map<string, { id: string; isDone: boolean | null }>();

  if (areaVirtualMatch) {
    const role = areaVirtualMatch[2] as ColumnRole;
    const boardIds = [...new Set(currentItems.map((item) => item.boardId))];
    const columnsForRole = await db
      .select({ id: boardColumns.id, boardId: boardColumns.boardId, isDone: boardColumns.isDone })
      .from(boardColumns)
      .where(and(inArray(boardColumns.boardId, boardIds), eq(boardColumns.role, role)))
      .orderBy(asc(boardColumns.order));

    for (const col of columnsForRole) {
      if (!destinationByBoardId.has(col.boardId)) {
        destinationByBoardId.set(col.boardId, { id: col.id, isDone: col.isDone });
      }
    }

    for (const boardId of boardIds) {
      if (!destinationByBoardId.has(boardId)) {
        throw new Error(
          `BOARD_COLUMN_ROLE_NOT_FOUND: No column with role "${role}" exists for board "${boardId}"`
        );
      }
    }
  } else {
    const [destColumn] = await db
      .select({ id: boardColumns.id, isDone: boardColumns.isDone })
      .from(boardColumns)
      .where(eq(boardColumns.id, boardColumnId))
      .limit(1);
    if (!destColumn) {
      throw new Error(`BOARD_COLUMN_NOT_FOUND: Column "${boardColumnId}" was not found`);
    }
    for (const item of currentItems) {
      destinationByBoardId.set(item.boardId, { id: destColumn.id, isDone: destColumn.isDone });
    }
  }

  // Get max position for each target column so moved items are appended at the end
  const targetColumnIds = [
    ...new Set(
      currentItems
        .map((item) => destinationByBoardId.get(item.boardId)?.id)
        .filter(Boolean)
    ),
  ] as string[];

  const maxPositions = new Map<string, number>();
  if (targetColumnIds.length > 0) {
    const posResults = await db
      .select({
        boardColumnId: workItems.boardColumnId,
        maxPos: sql<number>`coalesce(max(${workItems.position}), -1)`,
      })
      .from(workItems)
      .where(inArray(workItems.boardColumnId, targetColumnIds))
      .groupBy(workItems.boardColumnId);
    for (const r of posResults) {
      if (r.boardColumnId) maxPositions.set(r.boardColumnId, r.maxPos);
    }
  }

  // Track next position per column
  const nextPositionByColumn = new Map<string, number>();
  for (const colId of targetColumnIds) {
    nextPositionByColumn.set(colId, (maxPositions.get(colId) ?? -1) + 1);
  }

  // Guard: block entire batch if any item moving to Done has incomplete checklist
  const blockedItems: { id: string; taskId: string | null; uncheckedCount: number }[] = [];
  for (const item of currentItems) {
    const destination = destinationByBoardId.get(item.boardId);
    if (!destination?.isDone) continue;

    const checklistResult = hasIncompleteChecklist(item.metadata as Record<string, unknown> | null);
    if (checklistResult.hasIncomplete) {
      blockedItems.push({
        id: item.id,
        taskId: item.taskId,
        uncheckedCount: checklistResult.uncheckedCount,
      });
    }
  }
  if (blockedItems.length > 0) {
    const itemsList = blockedItems
      .map((b) => `${b.taskId ?? b.id} (${b.uncheckedCount} unchecked)`)
      .join(", ");
    throw new Error(
      `INCOMPLETE_CHECKLIST: ${blockedItems.length} items cannot be moved to Done with unchecked checklist items: [${itemsList}]`
    );
  }

  for (const item of currentItems) {
    const destination = destinationByBoardId.get(item.boardId);
    if (!destination) continue;

    const nextPos = nextPositionByColumn.get(destination.id) ?? 0;
    nextPositionByColumn.set(destination.id, nextPos + 1);

    const currentMetadata = (item.metadata as Record<string, unknown>) ?? {};
    let updatedMetadata: Record<string, unknown>;

    if (destination.isDone) {
      // Moving to done: set finishedAt
      updatedMetadata = { ...currentMetadata, finishedAt: now.toISOString() };
    } else {
      // Moving away from done: remove finishedAt
      const { finishedAt: _, ...rest } = currentMetadata;
      updatedMetadata = rest;
    }

    await db
      .update(workItems)
      .set({
        boardColumnId: destination.id,
        position: nextPos,
        metadata: updatedMetadata,
        updatedAt: now,
      })
      .where(eq(workItems.id, item.id));
  }

  return true;
};

// Save generated prompt to work item metadata
export const saveGeneratedPrompt = async (
  workspaceId: string,
  id: string,
  prompt: string
): Promise<boolean> => {
  // First verify the work item belongs to the workspace
  const [existingItem] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .where(and(eq(workItems.id, id), eq(boards.workspaceId, workspaceId)))
    .limit(1);

  if (!existingItem) return false;

  const now = new Date().toISOString();
  const [updated] = await db
    .update(workItems)
    .set({
      metadata: sql`jsonb_set(jsonb_set(coalesce(${workItems.metadata}, '{}'), '{generatedPrompt}', ${JSON.stringify(prompt)}::jsonb), '{promptGeneratedAt}', ${JSON.stringify(now)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(workItems.id, existingItem.id))
    .returning();

  return !!updated;
};

// Bulk change priority for work items
export const bulkChangePriority = async (
  workspaceId: string,
  workItemIds: string[],
  priority: "low" | "medium" | "high" | "urgent"
): Promise<boolean> => {
  if (workItemIds.length === 0) return false;

  // Verify items belong to org via board, then update only verified IDs
  const verifiedItems = await db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .where(and(inArray(workItems.id, workItemIds), eq(boards.workspaceId, workspaceId)));

  const verifiedIds = verifiedItems.map((i) => i.id);
  if (verifiedIds.length === 0) return false;

  const result = await db
    .update(workItems)
    .set({
      priority,
      updatedAt: new Date(),
    })
    .where(inArray(workItems.id, verifiedIds))
    .returning();

  return result.length > 0;
};

// ── Cascade sync helpers ──────────────────────────────────────────

/** Minimal child info needed for cascade operations */
export interface ChildWorkItemBasic {
  id: string;
  boardId: string;
  boardColumnId: string | null;
}

/** Get direct children of a work item (minimal fields for cascade) */
export const getDirectChildrenBasic = async (
  parentId: string
): Promise<ChildWorkItemBasic[]> => {
  return db
    .select({
      id: workItems.id,
      boardId: workItems.boardId,
      boardColumnId: workItems.boardColumnId,
    })
    .from(workItems)
    .where(eq(workItems.parentId, parentId));
};

/** Get a single board column by ID */
export const getColumnById = async (
  columnId: string
): Promise<{ id: string; boardId: string; name: string; isDone: boolean | null } | null> => {
  const [column] = await db
    .select({
      id: boardColumns.id,
      boardId: boardColumns.boardId,
      name: boardColumns.name,
      isDone: boardColumns.isDone,
    })
    .from(boardColumns)
    .where(eq(boardColumns.id, columnId))
    .limit(1);
  return column ?? null;
};

/** Find a column by normalized name (case-insensitive, trimmed) in a given board */
export const findColumnByNameInBoard = async (
  boardId: string,
  columnName: string
): Promise<{ id: string; name: string; isDone: boolean | null } | null> => {
  const normalized = columnName.trim().toLowerCase();
  const [column] = await db
    .select({
      id: boardColumns.id,
      name: boardColumns.name,
      isDone: boardColumns.isDone,
    })
    .from(boardColumns)
    .where(
      and(
        eq(boardColumns.boardId, boardId),
        sql`lower(trim(${boardColumns.name})) = ${normalized}`
      )
    )
    .limit(1);
  return column ?? null;
};

const findColumnByRoleInBoard = async (
  boardId: string,
  role: ColumnRole
): Promise<{ id: string; name: string; isDone: boolean | null } | null> => {
  const [column] = await db
    .select({
      id: boardColumns.id,
      name: boardColumns.name,
      isDone: boardColumns.isDone,
    })
    .from(boardColumns)
    .where(and(eq(boardColumns.boardId, boardId), eq(boardColumns.role, role)))
    .orderBy(asc(boardColumns.order))
    .limit(1);
  return column ?? null;
};

/**
 * Get all descendant leaf item IDs (tasks/ideas with a boardColumnId) for a
 * parent work item, walking up to 3 levels deep (epic→feature→story→task).
 */
export const getDescendantLeafIds = async (parentId: string): Promise<string[]> => {
  const leafIds: string[] = [];
  let currentParentIds = [parentId];

  for (let level = 0; level < 3 && currentParentIds.length > 0; level++) {
    const children = await db
      .select({
        id: workItems.id,
        boardColumnId: workItems.boardColumnId,
      })
      .from(workItems)
      .where(inArray(workItems.parentId, currentParentIds));

    const nextParentIds: string[] = [];
    for (const child of children) {
      if (child.boardColumnId) {
        leafIds.push(child.id);
      } else {
        nextParentIds.push(child.id);
      }
    }
    currentParentIds = nextParentIds;
  }

  return leafIds;
};

/**
 * Bulk-move children that share the same target column in a single UPDATE.
 * Returns the number of children actually updated.
 */
export const bulkMoveChildrenToColumn = async (
  childIds: string[],
  targetColumnId: string
): Promise<number> => {
  if (childIds.length === 0) return 0;
  const result = await db
    .update(workItems)
    .set({
      boardColumnId: targetColumnId,
      updatedAt: new Date(),
    })
    .where(inArray(workItems.id, childIds))
    .returning({ id: workItems.id });
  return result.length;
};

export const setWorkItemAiProcessing = async (
  workspaceId: string,
  workItemId: string,
  isAiProcessing: boolean
): Promise<boolean> => {
  // Verify item belongs to org via board before updating
  const [item] = await db
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .where(and(eq(workItems.id, workItemId), eq(boards.workspaceId, workspaceId)))
    .limit(1);

  if (!item) return false;

  const [updated] = await db
    .update(workItems)
    .set({
      isAiProcessing,
      updatedAt: new Date(),
    })
    .where(eq(workItems.id, workItemId))
    .returning({ id: workItems.id });

  return !!updated;
};

/**
 * Clear all AI processing state from a work item:
 * - Sets isAiProcessing = false
 * - Clears metadata.aiReserved and metadata.aiReservationProvider
 * Used when cancelling agent jobs to ensure the item is fully unblocked.
 */
export const clearWorkItemAiState = async (
  workItemId: string
): Promise<boolean> => {
  const [updated] = await db
    .update(workItems)
    .set({
      isAiProcessing: false,
      metadata: sql`jsonb_set(
        jsonb_set(
          coalesce(${workItems.metadata}, '{}'),
          '{aiReserved}', 'false'::jsonb
        ),
        '{aiReservationProvider}', 'null'::jsonb
      )`,
      updatedAt: new Date(),
    })
    .where(eq(workItems.id, workItemId))
    .returning({ id: workItems.id });

  return !!updated;
};

/**
 * Set or clear lastAiError in work item metadata.
 * When error is provided, sets metadata.lastAiError with timestamp and isAiProcessing=false.
 * When error is null, removes metadata.lastAiError (clears any previous error).
 */
export const setWorkItemAiError = async (
  workItemId: string,
  error: { message: string; type?: string; jobId?: string } | null
): Promise<boolean> => {
  if (error) {
    const errorPayload = JSON.stringify({
      message: error.message,
      ...(error.type ? { type: error.type } : {}),
      ...(error.jobId ? { jobId: error.jobId } : {}),
      at: new Date().toISOString(),
    });
    const [updated] = await db
      .update(workItems)
      .set({
        metadata: sql`jsonb_set(coalesce(${workItems.metadata}, '{}'), '{lastAiError}', ${errorPayload}::jsonb)`,
        isAiProcessing: false,
        updatedAt: new Date(),
      })
      .where(eq(workItems.id, workItemId))
      .returning({ id: workItems.id });
    return !!updated;
  }

  // Clear: remove the lastAiError key from metadata
  const [updated] = await db
    .update(workItems)
    .set({
      metadata: sql`coalesce(${workItems.metadata}, '{}') - 'lastAiError'`,
      updatedAt: new Date(),
    })
    .where(eq(workItems.id, workItemId))
    .returning({ id: workItems.id });
  return !!updated;
};

// ── Work Item Stats by Type ─────────────────────────────────────────

export interface WorkItemTypeStat {
  type: string;
  totalCount: number;
  completedCount: number;
}

export interface WorkItemStatsByType {
  byType: WorkItemTypeStat[];
  total: { totalCount: number; completedCount: number };
}

/**
 * Get work item statistics grouped by type for a given project.
 * Counts total items and completed items (in columns with isDone = true).
 * Excludes archived items (archivedAt IS NULL).
 */
export const getWorkItemStatsByType = async (
  projectId: string
): Promise<WorkItemStatsByType> => {
  const rows = await db
    .select({
      type: workItems.type,
      totalCount: sql<number>`count(*)::int`,
      completedCount: sql<number>`count(case when ${boardColumns.isDone} = true then 1 end)::int`,
    })
    .from(workItems)
    .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .where(
      and(
        eq(workItems.projectId, projectId),
        isNull(workItems.archivedAt)
      )
    )
    .groupBy(workItems.type);

  const total = rows.reduce(
    (acc, row) => ({
      totalCount: acc.totalCount + row.totalCount,
      completedCount: acc.completedCount + row.completedCount,
    }),
    { totalCount: 0, completedCount: 0 }
  );

  return { byType: rows, total };
};

/**
 * Returns work items ready for validation, grouped by their highest ancestor.
 *
 * 1. Finds all leaf work items (with boardColumnId) sitting in "review" columns.
 * 2. Walks up parentId (max 4 levels) to find the root ancestor.
 * 3. Groups leaf items under their root ancestor and deduplicates.
 */
export const getValidationCandidates = async (
  workspaceId?: string,
  projectId?: string,
  limit?: number,
  options?: { requireDodApproved?: boolean }
) => {
  // Step 1: Get all leaf items in review columns
  const conditions = [
    isNotNull(workItems.boardColumnId),
    isNull(workItems.archivedAt),
    eq(boardColumns.role, 'review'),
  ];

  if (options?.requireDodApproved === true) {
    conditions.push(sql`coalesce(${workItems.metadata}->>'dod_approved', 'false') = 'true'`);
  }

  if (projectId) {
    conditions.push(eq(workItems.projectId, projectId));
  } else if (workspaceId) {
    conditions.push(
      inArray(
        workItems.projectId,
        db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.workspaceId, workspaceId))
      )
    );
  }

  const reviewItems = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      type: workItems.type,
      parentId: workItems.parentId,
      boardId: workItems.boardId,
      projectId: workItems.projectId,
      workspaceId: projects.workspaceId,
    })
    .from(workItems)
    .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(and(...conditions));

  if (reviewItems.length === 0) return [];

  // Step 2: Walk up to find root ancestors (max 4 levels deep)
  type WorkItemRow = typeof reviewItems[number];
  const parentMap = new Map<string, WorkItemRow>();

  // Collect initial parent IDs to fetch
  let idsToFetch = new Set<string>();
  for (const item of reviewItems) {
    if (item.parentId) idsToFetch.add(item.parentId);
  }

  // Fetch parents iteratively up to 4 levels
  for (let level = 0; level < 4 && idsToFetch.size > 0; level++) {
    const missingIds = [...idsToFetch].filter((id) => !parentMap.has(id));
    if (missingIds.length === 0) break;

    const parents = await db
      .select({
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        type: workItems.type,
        parentId: workItems.parentId,
        boardId: workItems.boardId,
        projectId: workItems.projectId,
        workspaceId: projects.workspaceId,
      })
      .from(workItems)
      .leftJoin(projects, eq(workItems.projectId, projects.id))
      .where(inArray(workItems.id, missingIds));

    const nextIds = new Set<string>();
    for (const p of parents) {
      parentMap.set(p.id, p);
      if (p.parentId) nextIds.add(p.parentId);
    }
    idsToFetch = nextIds;
  }

  // Step 3: Group by root ancestor
  const candidateMap = new Map<string, WorkItemRow & {
    workspaceId: string | undefined;
    childIds: string[];
  }>();

  for (const item of reviewItems) {
    let root = item;
    let current = item;
    let depth = 0;
    while (current.parentId && depth < 4) {
      const parent = parentMap.get(current.parentId);
      if (!parent) break;
      root = parent;
      current = parent;
      depth++;
    }

    const existing = candidateMap.get(root.id);
    if (existing) {
      if (!existing.childIds.includes(item.id)) {
        existing.childIds.push(item.id);
      }
    } else {
      candidateMap.set(root.id, {
        id: root.id,
        taskId: root.taskId,
        title: root.title,
        type: root.type,
        boardId: root.boardId,
        projectId: root.projectId,
        workspaceId: item.workspaceId!,
        parentId: root.parentId ?? null,
        childIds: [item.id],
      });
    }
  }

  const candidates = Array.from(candidateMap.values());
  const effectiveLimit = typeof limit === "number" ? Math.max(0, limit) : undefined;

  return effectiveLimit === undefined ? candidates : candidates.slice(0, effectiveLimit);
};

/**
 * Get leaf work items in review columns that still need a Definition of Done check.
 *
 * The DoD review flags live in work_items.metadata because they are workflow
 * state, not core schema. A task is pending DoD review while it is in a review
 * column and neither `dod_approved` nor `dod_incompleted` is true.
 */
export const getDefinitionOfDoneReviewCandidates = async (
  workspaceId?: string,
  projectId?: string,
  limit?: number,
  options?: { minAgeMinutes?: number }
) => {
  const conditions = [
    isNotNull(workItems.boardColumnId),
    isNull(workItems.archivedAt),
    eq(boardColumns.role, "review"),
    sql`coalesce(${workItems.metadata}->>'dod_approved', 'false') <> 'true'`,
    sql`coalesce(${workItems.metadata}->>'dod_incompleted', 'false') <> 'true'`,
    sql`coalesce(${workItems.metadata}->>'dod_human_action_required', 'false') <> 'true'`,
    sql`coalesce(${workItems.metadata}->>'dod_human_review_required', 'false') <> 'true'`,
    sql`coalesce(${workItems.metadata}->>'dod_auto_remediation_blocked', 'false') <> 'true'`,
    sql`coalesce(${workItems.metadata}->>'dod_external_validation_required', 'false') <> 'true'`,
    // NOTE: use ->> with COALESCE so that JSONB null (stored as 'null'::jsonb)
    // is treated like a missing/empty value. The previous form
    // `metadata->'key' IS NULL` only matched a missing key — when the writer
    // stored an explicit JSON null (the common case in this codebase), `->`
    // returned 'null'::jsonb which is NOT SQL NULL, so the row was excluded
    // from review candidates and the DoD-review agent silently skipped every
    // task in the "review" column.
    sql`COALESCE(${workItems.metadata}->>'dod_external_validation_tools', '') IN ('', '[]')`,
  ];

  if (typeof options?.minAgeMinutes === "number" && options.minAgeMinutes > 0) {
    const cutoff = new Date(Date.now() - options.minAgeMinutes * 60_000).toISOString();
    conditions.push(sql`${workItems.updatedAt} <= ${cutoff}`);
  }

  if (projectId) {
    conditions.push(eq(workItems.projectId, projectId));
  } else if (workspaceId) {
    conditions.push(
      inArray(
        workItems.projectId,
        db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.workspaceId, workspaceId))
      )
    );
  }

  const reviewItems = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      description: workItems.description,
      type: workItems.type,
      priority: workItems.priority,
      parentId: workItems.parentId,
      boardId: workItems.boardId,
      projectId: workItems.projectId,
      workspaceId: projects.workspaceId,
      columnName: boardColumns.name,
      updatedAt: workItems.updatedAt,
      metadata: workItems.metadata,
    })
    .from(workItems)
    .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(asc(workItems.position), asc(workItems.createdAt));

  if (reviewItems.length === 0) return [];

  type WorkItemRow = typeof reviewItems[number];
  const parentMap = new Map<string, WorkItemRow>();

  let idsToFetch = new Set<string>();
  for (const item of reviewItems) {
    if (item.parentId) idsToFetch.add(item.parentId);
  }

  for (let level = 0; level < 4 && idsToFetch.size > 0; level++) {
    const missingIds = [...idsToFetch].filter((id) => !parentMap.has(id));
    if (missingIds.length === 0) break;

    const parents = await db
      .select({
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        description: workItems.description,
        type: workItems.type,
        priority: workItems.priority,
        parentId: workItems.parentId,
        boardId: workItems.boardId,
        projectId: workItems.projectId,
        workspaceId: projects.workspaceId,
        columnName: sql<string>`''`,
        updatedAt: workItems.updatedAt,
        metadata: workItems.metadata,
      })
      .from(workItems)
      .leftJoin(projects, eq(workItems.projectId, projects.id))
      .where(inArray(workItems.id, missingIds));

    const nextIds = new Set<string>();
    for (const parent of parents) {
      parentMap.set(parent.id, parent);
      if (parent.parentId) nextIds.add(parent.parentId);
    }
    idsToFetch = nextIds;
  }

  const candidateMap = new Map<string, WorkItemRow & {
    childIds: string[];
    reviewColumnName: string;
    latestChildUpdatedAt: Date;
  }>();

  for (const item of reviewItems) {
    let root = item;
    let current = item;
    let depth = 0;

    while (current.parentId && depth < 4) {
      const parent = parentMap.get(current.parentId);
      if (!parent) break;
      root = parent;
      current = parent;
      depth++;
    }

    const existing = candidateMap.get(root.id);
    if (existing) {
      if (!existing.childIds.includes(item.id)) {
        existing.childIds.push(item.id);
      }
      if (item.updatedAt > existing.latestChildUpdatedAt) {
        existing.latestChildUpdatedAt = item.updatedAt;
      }
    } else {
      candidateMap.set(root.id, {
        ...root,
        childIds: [item.id],
        reviewColumnName: item.columnName,
        latestChildUpdatedAt: item.updatedAt,
      });
    }
  }

  const candidates = [...candidateMap.values()];

  const effectiveLimit = typeof limit === "number" ? Math.max(0, limit) : undefined;
  const limitedCandidates = effectiveLimit === undefined ? candidates : candidates.slice(0, effectiveLimit);

  return limitedCandidates.map((candidate) => {
    const metadata = (candidate.metadata as Record<string, unknown> | null) ?? {};
    return {
      id: candidate.id,
      taskId: candidate.taskId,
      title: candidate.title,
      description: candidate.description,
      type: candidate.type,
      priority: candidate.priority,
      parentId: candidate.parentId ?? null,
      boardId: candidate.boardId,
      projectId: candidate.projectId,
      workspaceId: candidate.workspaceId,
      columnName: candidate.reviewColumnName,
      updatedAt: candidate.latestChildUpdatedAt.toISOString(),
      definitionOfDone: typeof metadata.definitionOfDone === "string" ? metadata.definitionOfDone : null,
      dodReport: typeof metadata.dod_report === "string" ? metadata.dod_report : null,
      dodReviewedAt: typeof metadata.dod_reviewed_at === "string" ? metadata.dod_reviewed_at : null,
      childIds: candidate.childIds,
    };
  });
};

/**
 * Get work items that are candidates for nightly fix.
 * Returns items routed for corrective work that have fewer than 2 fix attempts.
 * Canonical Desarrollo boards no longer expose a To Fix column: failed
 * validation routes back to In Progress with metadata.lastValidationResult='fail'.
 * Legacy Needs Fix columns are still supported for older boards.
 * Fix attempts are tracked in the work item's metadata.fixAttempts field.
 */
export const getFixCandidates = async (workspaceId?: string, projectId?: string) => {
  const conditions = [
    isNotNull(workItems.boardColumnId),
    isNull(workItems.archivedAt),
    or(
      eq(boardColumns.role, 'needs_fix'),
      and(
        eq(boardColumns.role, 'in_progress'),
        sql`${workItems.metadata}->>'lastValidationResult' = 'fail'`
      )
    )!,
  ];

  if (projectId) {
    conditions.push(eq(workItems.projectId, projectId));
  } else if (workspaceId) {
    conditions.push(
      inArray(
        workItems.projectId,
        db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.workspaceId, workspaceId))
      )
    );
  }

  const needsFixItems = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      type: workItems.type,
      parentId: workItems.parentId,
      boardId: workItems.boardId,
      projectId: workItems.projectId,
      workspaceId: projects.workspaceId,
      metadata: workItems.metadata,
    })
    .from(workItems)
    .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(and(...conditions));

  if (needsFixItems.length === 0) return [];

  // Filter out items with 2+ fix attempts
  return needsFixItems
    .filter((item) => {
      const meta = item.metadata as Record<string, unknown> | null;
      const fixAttempts = typeof meta?.fixAttempts === "number" ? meta.fixAttempts : 0;
      return fixAttempts < 2;
    })
    .map((item) => {
      const meta = item.metadata as Record<string, unknown> | null;
      return {
        id: item.id,
        taskId: item.taskId,
        title: item.title,
        type: item.type,
        parentId: item.parentId ?? null,
        boardId: item.boardId,
        projectId: item.projectId,
        workspaceId: item.workspaceId,
        fixAttempts: typeof meta?.fixAttempts === "number" ? meta.fixAttempts : 0,
      };
    });
};

/**
 * Reset stale child work items that are stuck in transient AI states with isAiProcessing=true.
 * Handles both "In Progress" (from implement) and "Validating" (from validate) states.
 * - "In Progress" items are moved back to "Backlog"
 * - "Validating" items are moved back to "Reviewing"
 * Finds descendants (children and grandchildren) of the given parent work item.
 * Returns the list of reset work item IDs.
 */
export const resetStaleChildWorkItems = async (
  parentWorkItemId: string
): Promise<string[]> => {
  // Alias for the self-join to find grandchildren
  const parentItems = workItems as typeof workItems;

  // Find descendant work items (children and grandchildren) stuck in transient AI states
  const staleItems = await db
    .select({
      id: workItems.id,
      boardId: workItems.boardId,
      columnName: boardColumns.name,
    })
    .from(workItems)
    .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .where(
      and(
        or(
          // Direct children
          eq(workItems.parentId, parentWorkItemId),
          // Grandchildren: items whose parent's parentId = parentWorkItemId
          inArray(
            workItems.parentId,
            db
              .select({ id: parentItems.id })
              .from(parentItems)
              .where(eq(parentItems.parentId, parentWorkItemId))
          )
        ),
        eq(workItems.isAiProcessing, true),
        sql`lower(trim(${boardColumns.name})) IN ('in progress', 'validating')`
      )
    );

  if (staleItems.length === 0) return [];

  // Group items by boardId AND source column to determine the correct reset target
  const inProgressByBoard = new Map<string, string[]>();
  const validatingByBoard = new Map<string, string[]>();

  for (const item of staleItems) {
    const colLower = item.columnName.trim().toLowerCase();
    const map = colLower === "validating" ? validatingByBoard : inProgressByBoard;
    const list = map.get(item.boardId);
    if (list) list.push(item.id);
    else map.set(item.boardId, [item.id]);
  }

  const resetIds: string[] = [];
  const now = new Date();

  // Reset "In Progress" items → "Backlog"
  for (const [boardId, itemIds] of inProgressByBoard) {
    const backlogColumn =
      await findColumnByRoleInBoard(boardId, "backlog")
      ?? await findColumnByNameInBoard(boardId, "Backlog");
    if (!backlogColumn) continue;

    await db
      .update(workItems)
      .set({ boardColumnId: backlogColumn.id, isAiProcessing: false, updatedAt: now })
      .where(inArray(workItems.id, itemIds));

    resetIds.push(...itemIds);
  }

  // Reset "Validating" items → "Reviewing"
  for (const [boardId, itemIds] of validatingByBoard) {
    const reviewColumn =
      await findColumnByRoleInBoard(boardId, "review")
      ?? await findColumnByNameInBoard(boardId, "Reviewing")
      ?? await findColumnByNameInBoard(boardId, "To Review");
    if (!reviewColumn) continue;

    await db
      .update(workItems)
      .set({ boardColumnId: reviewColumn.id, isAiProcessing: false, updatedAt: now })
      .where(inArray(workItems.id, itemIds));

    resetIds.push(...itemIds);
  }

  return resetIds;
};

/**
 * Resolve task IDs to work item IDs and board areas.
 * Used for linking task ID references in transcripts.
 */
export const resolveTaskIds = async (
  taskIds: string[],
  orgId: string,
): Promise<Array<{ taskId: string; workItemId: string; boardArea: string }>> => {
  if (taskIds.length === 0) return [];

  const results = await db
    .select({
      taskId: workItems.taskId,
      workItemId: workItems.id,
      boardArea: boards.area,
    })
    .from(workItems)
    .innerJoin(boards, eq(workItems.boardId, boards.id))
    .where(
      and(
        inArray(workItems.taskId, taskIds),
        buildWorkspaceScopedProjectCondition(orgId),
      )
    );

  return results.flatMap((result) =>
    result.taskId
      ? [{
          taskId: result.taskId,
          workItemId: result.workItemId,
          boardArea: result.boardArea,
        }]
      : []
  );
};

/**
 * Get the count of non-archived direct children for each parent ID in a single query.
 * Returns a Map from parentId to child count. Parent IDs with zero children are omitted.
 */
export const getChildCountsByParentIds = async (
  parentIds: string[]
): Promise<Map<string, number>> => {
  if (parentIds.length === 0) return new Map();

  const rows = await db
    .select({
      parentId: workItems.parentId,
      count: sql<number>`count(*)::int`,
    })
    .from(workItems)
    .where(
      and(
        inArray(workItems.parentId, parentIds),
        isNull(workItems.archivedAt)
      )
    )
    .groupBy(workItems.parentId);

  const result = new Map<string, number>();
  for (const row of rows) {
    if (row.parentId) {
      result.set(row.parentId, row.count);
    }
  }
  return result;
};
