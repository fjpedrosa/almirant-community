import { db } from "../../client";
import { workItems, workItemEvents, boardColumns, boards, projects } from "../../schema";
import { eq, and, sql, inArray, isNull } from "drizzle-orm";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface RoadmapDates {
  startDate: string | null;
  endDate: string | null;
}

interface RoadmapStory {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  priority: string;
  assignee: string | null;
  boardColumnId: string | null;
  columnName: string | null;
  startDate: string | null;
  endDate: string | null;
}

interface RoadmapFeature {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  priority: string;
  assignee: string | null;
  boardColumnId: string | null;
  columnName: string | null;
  startDate: string | null;
  endDate: string | null;
  children: RoadmapStory[];
}

interface RoadmapEpic {
  id: string;
  taskId: string | null;
  title: string;
  type: string;
  priority: string;
  assignee: string | null;
  boardColumnId: string | null;
  columnName: string | null;
  startDate: string | null;
  endDate: string | null;
  children: RoadmapFeature[];
}

export interface ProjectRoadmap {
  projectId: string;
  epics: RoadmapEpic[];
}

// ──────────────────────────────────────────────
// Helper: compute dates from events for a set of work item IDs
// ──────────────────────────────────────────────

// Returns a map of workItemId -> { startDate, endDate }
// startDate = first "moved" event where newValue is an "In Progress" column (name = 'In Progress')
// endDate = last "moved" event where newValue is a "Done" column (isDone = true)
const computeDatesFromEvents = async (
  workItemIds: string[],
  inProgressColumnIds: string[],
  doneColumnIds: string[]
): Promise<Map<string, RoadmapDates>> => {
  const dateMap = new Map<string, RoadmapDates>();

  if (workItemIds.length === 0) return dateMap;

  // Initialize all items with null dates
  for (const id of workItemIds) {
    dateMap.set(id, { startDate: null, endDate: null });
  }

  if (inProgressColumnIds.length === 0 && doneColumnIds.length === 0) {
    return dateMap;
  }

  // Get all relevant "moved" events for these work items in a single query
  const movedEvents = await db
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
    );

  // Process events to find first "In Progress" and last "Done" per work item
  for (const event of movedEvents) {
    const entry = dateMap.get(event.workItemId);
    if (!entry || !event.newValue || !event.createdAt) continue;

    const eventTime = new Date(event.createdAt).toISOString();

    // Check if moved to In Progress column
    if (inProgressColumnIds.includes(event.newValue)) {
      if (!entry.startDate || eventTime < entry.startDate) {
        entry.startDate = eventTime;
      }
    }

    // Check if moved to Done column
    if (doneColumnIds.includes(event.newValue)) {
      if (!entry.endDate || eventTime > entry.endDate) {
        entry.endDate = eventTime;
      }
    }
  }

  return dateMap;
};

// Compute dates for parent items based on their children's dates
const computeParentDates = (
  childrenDates: RoadmapDates[]
): RoadmapDates => {
  let earliestStart: string | null = null;
  let latestEnd: string | null = null;

  for (const dates of childrenDates) {
    if (dates.startDate) {
      if (!earliestStart || dates.startDate < earliestStart) {
        earliestStart = dates.startDate;
      }
    }
    if (dates.endDate) {
      if (!latestEnd || dates.endDate > latestEnd) {
        latestEnd = dates.endDate;
      }
    }
  }

  return { startDate: earliestStart, endDate: latestEnd };
};

// ──────────────────────────────────────────────
// Main: get project roadmap
// ──────────────────────────────────────────────

export const getProjectRoadmap = async (
  projectId: string
): Promise<ProjectRoadmap> => {
  // Step 1: Get the project's organization, then find boards in that org
  const [project] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const projectBoards = project?.organizationId
    ? await db
        .select({ id: boards.id })
        .from(boards)
        .where(eq(boards.organizationId, project.organizationId))
    : [];

  const boardIds = projectBoards.map((b) => b.id);

  let inProgressColumnIds: string[] = [];
  let doneColumnIds: string[] = [];

  if (boardIds.length > 0) {
    // Get "In Progress" columns (by name convention)
    const inProgressCols = await db
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(
        and(
          inArray(boardColumns.boardId, boardIds),
          sql`lower(${boardColumns.name}) = 'in progress'`
        )
      );
    inProgressColumnIds = inProgressCols.map((c) => c.id);

    // Get "Done" columns (by isDone flag)
    const doneCols = await db
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(
        and(
          inArray(boardColumns.boardId, boardIds),
          eq(boardColumns.isDone, true)
        )
      );
    doneColumnIds = doneCols.map((c) => c.id);
  }

  // Step 2: Get all non-archived work items for this project with their column names
  const allItems = await db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      type: workItems.type,
      priority: workItems.priority,
      assignee: workItems.assignee,
      parentId: workItems.parentId,
      boardColumnId: workItems.boardColumnId,
      columnName: boardColumns.name,
    })
    .from(workItems)
    .leftJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .where(
      and(
        eq(workItems.projectId, projectId),
        isNull(workItems.archivedAt)
      )
    );

  // Step 3: Organize items by type and build hierarchy maps
  const epics = allItems.filter((i) => i.type === "epic");
  const features = allItems.filter((i) => i.type === "feature");
  const storiesAndTasks = allItems.filter(
    (i) => i.type === "story" || i.type === "task"
  );

  // Build parent -> children maps
  const featuresByParent = new Map<string, typeof features>();
  for (const f of features) {
    if (!f.parentId) continue;
    const existing = featuresByParent.get(f.parentId) ?? [];
    existing.push(f);
    featuresByParent.set(f.parentId, existing);
  }

  const storiesByParent = new Map<string, typeof storiesAndTasks>();
  for (const s of storiesAndTasks) {
    if (!s.parentId) continue;
    const existing = storiesByParent.get(s.parentId) ?? [];
    existing.push(s);
    storiesByParent.set(s.parentId, existing);
  }

  // Step 4: Compute dates from events for all leaf-level items (stories/tasks)
  // Also compute for features and epics themselves (they may have direct events)
  const allItemIds = allItems.map((i) => i.id);
  const eventDates = await computeDatesFromEvents(
    allItemIds,
    inProgressColumnIds,
    doneColumnIds
  );

  // Step 5: Build the hierarchical roadmap structure
  const roadmapEpics: RoadmapEpic[] = epics.map((epic) => {
    const epicFeatures = featuresByParent.get(epic.id) ?? [];

    const builtFeatures: RoadmapFeature[] = epicFeatures.map((feature) => {
      const featureStories = storiesByParent.get(feature.id) ?? [];

      const builtStories: RoadmapStory[] = featureStories.map((story) => {
        const dates = eventDates.get(story.id) ?? {
          startDate: null,
          endDate: null,
        };
        return {
          id: story.id,
          taskId: story.taskId,
          title: story.title,
          type: story.type,
          priority: story.priority,
          assignee: story.assignee,
          boardColumnId: story.boardColumnId,
          columnName: story.columnName,
          startDate: dates.startDate,
          endDate: dates.endDate,
        };
      });

      // Feature dates: calculated from children if available, fallback to own events
      const childrenDatesForFeature = builtStories.map((s) => ({
        startDate: s.startDate,
        endDate: s.endDate,
      }));

      const featureOwnDates = eventDates.get(feature.id) ?? {
        startDate: null,
        endDate: null,
      };

      const featureComputedDates =
        childrenDatesForFeature.length > 0
          ? computeParentDates(childrenDatesForFeature)
          : featureOwnDates;

      // Merge: prefer computed from children, fallback to own events
      const featureDates: RoadmapDates = {
        startDate:
          featureComputedDates.startDate ?? featureOwnDates.startDate,
        endDate: featureComputedDates.endDate ?? featureOwnDates.endDate,
      };

      return {
        id: feature.id,
        taskId: feature.taskId,
        title: feature.title,
        type: feature.type,
        priority: feature.priority,
        assignee: feature.assignee,
        boardColumnId: feature.boardColumnId,
        columnName: feature.columnName,
        startDate: featureDates.startDate,
        endDate: featureDates.endDate,
        children: builtStories,
      };
    });

    // Epic dates: calculated from children (features) if available, fallback to own events
    const childrenDatesForEpic = builtFeatures.map((f) => ({
      startDate: f.startDate,
      endDate: f.endDate,
    }));

    const epicOwnDates = eventDates.get(epic.id) ?? {
      startDate: null,
      endDate: null,
    };

    const epicComputedDates =
      childrenDatesForEpic.length > 0
        ? computeParentDates(childrenDatesForEpic)
        : epicOwnDates;

    // Merge: prefer computed from children, fallback to own events
    const epicDates: RoadmapDates = {
      startDate: epicComputedDates.startDate ?? epicOwnDates.startDate,
      endDate: epicComputedDates.endDate ?? epicOwnDates.endDate,
    };

    return {
      id: epic.id,
      taskId: epic.taskId,
      title: epic.title,
      type: epic.type,
      priority: epic.priority,
      assignee: epic.assignee,
      boardColumnId: epic.boardColumnId,
      columnName: epic.columnName,
      startDate: epicDates.startDate,
      endDate: epicDates.endDate,
      children: builtFeatures,
    };
  });

  return {
    projectId,
    epics: roadmapEpics,
  };
};
