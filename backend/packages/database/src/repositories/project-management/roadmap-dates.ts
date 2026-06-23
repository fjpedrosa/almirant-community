import { db } from "../../client";
import { workItems, workItemEvents, boardColumns } from "../../schema";
import { eq, and, inArray, asc, sql } from "drizzle-orm";
import type { WorkItemType } from "../../domain/types";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

/** A nullable date range representing when work started and ended */
export interface DateRange {
  startDate: Date | null;
  endDate: Date | null;
}

/** Minimal work item info needed for hierarchical date calculation */
export interface WorkItemForDateCalculation {
  id: string;
  parentId: string | null;
  type: WorkItemType;
  boardColumnId: string | null;
}

/** A work item enriched with computed date range from its hierarchy */
export interface WorkItemWithDates extends WorkItemForDateCalculation {
  dateRange: DateRange;
}

/** Internal representation of a "moved" event relevant to date extraction */
interface ColumnMoveEvent {
  workItemId: string;
  newColumnId: string;
  createdAt: Date;
}

/** Map of column ID to whether the column is a "started" column or a "done" column. */
interface ColumnClassification {
  isDone: boolean;
  isStarted: boolean;
}

const isStartedByRole = (role: string | null): boolean => {
  if (!role || role === "other") return false;
  return role !== "backlog" && role !== "todo";
};

const isDoneByName = (name: string): boolean => /done|hecho|completed|won|lost|published|calificado|descartado/i.test(name);
const isStartedByName = (name: string): boolean => /progress|doing|en progreso|review|revision|testing|test|qa|validating|release/i.test(name);

// ──────────────────────────────────────────────
// Pure functions (no DB access)
// ──────────────────────────────────────────────

/**
 * Given a list of "moved" events for a single work item and a column classification map,
 * determine the start and end dates.
 *
 * - startDate: the timestamp of the earliest event where the item moved to a "started" column
 *   (normally In Progress or later in the canonical workflow)
 * - endDate: the timestamp of the latest event where the item moved to a "done" column
 *
 * If the item has no relevant events, returns null for both dates.
 */
export const extractDatesFromEvents = (
  events: ColumnMoveEvent[],
  columnMap: Map<string, ColumnClassification>
): DateRange => {
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  for (const event of events) {
    const classification = columnMap.get(event.newColumnId);
    if (!classification) continue;

    // Start date: first time moved to a "started" column
    if (classification.isStarted && (startDate === null || event.createdAt < startDate)) {
      startDate = event.createdAt;
    }

    // End date: last time moved to a "done" column
    if (classification.isDone && (endDate === null || event.createdAt > endDate)) {
      endDate = event.createdAt;
    }
  }

  return { startDate, endDate };
};

/**
 * Aggregate multiple child date ranges into a single parent date range.
 *
 * - startDate = earliest startDate among children
 * - endDate = latest endDate among children (only if ALL children with startDates also have endDates)
 *
 * If no children have dates, returns null/null.
 */
export const aggregateChildDates = (childDates: DateRange[]): DateRange => {
  let earliestStart: Date | null = null;
  let latestEnd: Date | null = null;
  let hasStartedChild = false;
  let allStartedChildrenFinished = true;

  for (const { startDate, endDate } of childDates) {
    if (startDate !== null) {
      hasStartedChild = true;

      if (earliestStart === null || startDate < earliestStart) {
        earliestStart = startDate;
      }

      if (endDate !== null) {
        if (latestEnd === null || endDate > latestEnd) {
          latestEnd = endDate;
        }
      } else {
        // This child started but hasn't finished
        allStartedChildrenFinished = false;
      }
    }
  }

  // If no child has started, return null/null
  if (!hasStartedChild) {
    return { startDate: null, endDate: null };
  }

  // Only report endDate if ALL started children have finished
  return {
    startDate: earliestStart,
    endDate: allStartedChildrenFinished ? latestEnd : null,
  };
};

/**
 * Build a parent-to-children map from a flat list of work items.
 * Items without a parentId (root items) are keyed under the special key "ROOT".
 */
export const buildChildrenMap = (
  items: WorkItemForDateCalculation[]
): Map<string, WorkItemForDateCalculation[]> => {
  const childrenMap = new Map<string, WorkItemForDateCalculation[]>();

  for (const item of items) {
    const parentKey = item.parentId ?? "ROOT";
    const children = childrenMap.get(parentKey);
    if (children) {
      children.push(item);
    } else {
      childrenMap.set(parentKey, [item]);
    }
  }

  return childrenMap;
};

/**
 * Calculate hierarchical dates for a set of work items, bottom-up.
 *
 * The hierarchy order is: task -> story -> feature -> epic
 * - Leaf items (tasks, or items with no children) get dates from their move events.
 * - Parent items (stories, features, epics) inherit dates by aggregating their children.
 *
 * @param items - Flat list of work items (must include the full hierarchy for the project/board)
 * @param eventsByWorkItem - Map of workItemId -> their column move events
 * @param columnMap - Map of columnId -> classification (isDone, isStarted)
 * @returns Map of workItemId -> DateRange
 */
export const calculateHierarchicalDates = (
  items: WorkItemForDateCalculation[],
  eventsByWorkItem: Map<string, ColumnMoveEvent[]>,
  columnMap: Map<string, ColumnClassification>
): Map<string, DateRange> => {
  const dateMap = new Map<string, DateRange>();
  const itemMap = new Map<string, WorkItemForDateCalculation>();
  const childrenMap = buildChildrenMap(items);

  for (const item of items) {
    itemMap.set(item.id, item);
  }

  // Recursive function to compute dates for an item (with memoization via dateMap)
  const computeDates = (itemId: string): DateRange => {
    // Already computed
    const cached = dateMap.get(itemId);
    if (cached !== undefined) return cached;

    const item = itemMap.get(itemId);
    if (!item) {
      const nullRange: DateRange = { startDate: null, endDate: null };
      dateMap.set(itemId, nullRange);
      return nullRange;
    }

    const children = childrenMap.get(itemId);

    // Leaf item (no children): extract dates from its own events
    if (!children || children.length === 0) {
      const events = eventsByWorkItem.get(itemId) ?? [];
      const dateRange = extractDatesFromEvents(events, columnMap);

      // If there are no move events, check the current column as a fallback
      // (item might have been created directly in an "in progress" column)
      if (dateRange.startDate === null && item.boardColumnId) {
        const classification = columnMap.get(item.boardColumnId);
        if (classification?.isStarted) {
          // Use a "created" event if available, otherwise check the events table
          const createdEvent = eventsByWorkItem.get(itemId)?.find(
            (e) => e.newColumnId === item.boardColumnId
          );
          if (createdEvent) {
            dateRange.startDate = createdEvent.createdAt;
          }
        }
      }

      dateMap.set(itemId, dateRange);
      return dateRange;
    }

    // Parent item: recursively compute children dates first, then aggregate
    const childDateRanges = children.map((child) => computeDates(child.id));
    const aggregated = aggregateChildDates(childDateRanges);

    dateMap.set(itemId, aggregated);
    return aggregated;
  };

  // Compute dates for all items
  for (const item of items) {
    computeDates(item.id);
  }

  return dateMap;
};

// ──────────────────────────────────────────────
// Database query functions
// ──────────────────────────────────────────────

/**
 * Fetch the column classification map for a given set of board IDs.
 * Returns a map of columnId -> { isDone, isStarted }.
 */
export const fetchColumnClassifications = async (
  boardIds: string[]
): Promise<Map<string, ColumnClassification>> => {
  if (boardIds.length === 0) return new Map();

  const columns = await db
    .select({
      id: boardColumns.id,
      isDone: boardColumns.isDone,
      order: boardColumns.order,
      role: boardColumns.role,
      name: boardColumns.name,
    })
    .from(boardColumns)
    .where(inArray(boardColumns.boardId, boardIds));

  const columnMap = new Map<string, ColumnClassification>();
  for (const col of columns) {
    const byRoleDone = col.role === "done";
    const byRoleStarted = isStartedByRole(col.role);
    const byNameDone = isDoneByName(col.name);
    const byNameStarted = isStartedByName(col.name);
    columnMap.set(col.id, {
      isDone: byRoleDone || (col.isDone ?? byNameDone),
      isStarted: byRoleStarted || byNameStarted || col.order >= 2,
    });
  }

  return columnMap;
};

/**
 * Fetch all "moved" events for a set of work item IDs.
 * Returns a map of workItemId -> ColumnMoveEvent[].
 *
 * Events are filtered to only include "moved" type with fieldName "boardColumnId".
 * They are sorted by createdAt ascending per work item.
 */
export const fetchMoveEventsForWorkItems = async (
  workItemIds: string[]
): Promise<Map<string, ColumnMoveEvent[]>> => {
  if (workItemIds.length === 0) return new Map();

  const events = await db
    .select({
      workItemId: workItemEvents.workItemId,
      newValue: workItemEvents.newValue,
      createdAt: workItemEvents.createdAt,
    })
    .from(workItemEvents)
    .where(
      and(
        inArray(workItemEvents.workItemId, workItemIds),
        eq(workItemEvents.eventType, "moved"),
        eq(workItemEvents.fieldName, "boardColumnId")
      )
    )
    .orderBy(asc(workItemEvents.createdAt));

  const eventMap = new Map<string, ColumnMoveEvent[]>();
  for (const event of events) {
    if (!event.newValue) continue;

    const moveEvent: ColumnMoveEvent = {
      workItemId: event.workItemId,
      newColumnId: event.newValue,
      createdAt: event.createdAt,
    };

    const existing = eventMap.get(event.workItemId);
    if (existing) {
      existing.push(moveEvent);
    } else {
      eventMap.set(event.workItemId, [moveEvent]);
    }
  }

  return eventMap;
};

/**
 * Fetch all work items for a project, returning only the fields needed for date calculation.
 * Excludes archived items.
 */
export const fetchWorkItemsForProject = async (
  projectId: string
): Promise<WorkItemForDateCalculation[]> => {
  const items = await db
    .select({
      id: workItems.id,
      parentId: workItems.parentId,
      type: workItems.type,
      boardColumnId: workItems.boardColumnId,
    })
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        sql`${workItems.archivedAt} IS NULL`
      )
    );

  return items as WorkItemForDateCalculation[];
};

/**
 * High-level function: compute hierarchical dates for all work items in a project.
 *
 * This orchestrates the full flow:
 * 1. Fetch work items for the project
 * 2. Fetch column classifications for the boards involved
 * 3. Fetch move events for all work items
 * 4. Calculate hierarchical dates bottom-up
 *
 * @returns Map of workItemId -> DateRange
 */
export const computeProjectWorkItemDates = async (
  projectId: string
): Promise<Map<string, DateRange>> => {
  // Step 1: Fetch work items
  const items = await fetchWorkItemsForProject(projectId);

  if (items.length === 0) return new Map();

  // Step 2: Derive board IDs from column IDs and fetch column classifications
  const columnBoardMap = await fetchBoardIdsFromColumns(
    items.map((i) => i.boardColumnId).filter((id): id is string => id !== null)
  );
  const uniqueBoardIds = [...new Set(columnBoardMap.values())];
  const columnMap = await fetchColumnClassifications(uniqueBoardIds);

  // Step 3: Fetch move events
  const workItemIds = items.map((item) => item.id);
  const eventsByWorkItem = await fetchMoveEventsForWorkItems(workItemIds);

  // Step 4: Calculate hierarchical dates
  return calculateHierarchicalDates(items, eventsByWorkItem, columnMap);
};

/**
 * Fetch board IDs from a list of column IDs.
 * Returns a map of columnId -> boardId.
 */
const fetchBoardIdsFromColumns = async (
  columnIds: string[]
): Promise<Map<string, string>> => {
  if (columnIds.length === 0) return new Map();

  const uniqueColumnIds = [...new Set(columnIds)];

  const columns = await db
    .select({
      id: boardColumns.id,
      boardId: boardColumns.boardId,
    })
    .from(boardColumns)
    .where(inArray(boardColumns.id, uniqueColumnIds));

  const map = new Map<string, string>();
  for (const col of columns) {
    map.set(col.id, col.boardId);
  }

  return map;
};

/**
 * High-level function: compute hierarchical dates for a specific set of work items.
 *
 * Useful when you already have the work items and just need dates computed.
 * This fetches the necessary column and event data and performs the calculation.
 *
 * @param items - The work items to compute dates for (must include full hierarchy)
 * @returns Map of workItemId -> DateRange
 */
export const computeDatesForWorkItems = async (
  items: WorkItemForDateCalculation[]
): Promise<Map<string, DateRange>> => {
  if (items.length === 0) return new Map();

  // Get unique column IDs to find board IDs
  const columnBoardMap = await fetchBoardIdsFromColumns(
    items.map((i) => i.boardColumnId).filter((id): id is string => id !== null)
  );
  const uniqueBoardIds = [...new Set(columnBoardMap.values())];
  const columnMap = await fetchColumnClassifications(uniqueBoardIds);

  // Fetch move events
  const workItemIds = items.map((item) => item.id);
  const eventsByWorkItem = await fetchMoveEventsForWorkItems(workItemIds);

  // Calculate hierarchical dates
  return calculateHierarchicalDates(items, eventsByWorkItem, columnMap);
};
