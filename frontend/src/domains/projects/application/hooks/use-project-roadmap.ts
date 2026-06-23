"use client";

import { useState, useMemo, useCallback } from "react";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAllBoards } from "@/domains/boards/application/hooks/use-boards";
import { workItemsApi } from "@/lib/api/client";
import { workItemKeys } from "@/domains/work-items/application/hooks/use-work-items";
import type { WorkItemWithRelations } from "@/domains/work-items/domain/types";
import type { BoardWithStats } from "@/domains/boards/domain/types";
import type {
  GanttTask,
  GanttLink,
  GanttZoomLevel,
  GanttColorMode,
  GanttColumnConfig,
  GanttScalePresets,
} from "../../domain/types";
import type { IScaleConfig } from "@svar-ui/react-gantt";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Deterministic numeric hash from a UUID string.
 * We need numeric IDs because @svar-ui/react-gantt uses number IDs.
 */
const uuidToNumericId = (uuid: string): number => {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const char = uuid.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  // Ensure positive
  return Math.abs(hash);
};

/**
 * Get color based on the column semantics (done, in-progress, etc.)
 */
const getStatusColor = (
  columnName: string,
  isDone: boolean
): string => {
  if (isDone) return "#22c55e"; // green

  const lower = columnName.toLowerCase();

  if (lower.includes("progress") || lower.includes("doing") || lower.includes("desarrollo"))
    return "#f59e0b"; // amber

  if (lower.includes("review") || lower.includes("testing") || lower.includes("qa") || lower.includes("document"))
    return "#3b82f6"; // blue

  // backlog, todo, or anything else
  return "#94a3b8"; // gray
};

/**
 * Generate reasonable default dates for items without them.
 * Spreads items across a 3-month window starting from today.
 */
const generateDefaultDates = (
  index: number,
  total: number,
  baseDate: Date
): { start: Date; end: Date } => {
  const windowDays = 90; // 3-month window
  const slotSize = total > 1 ? windowDays / total : 14;
  const offsetDays = Math.floor(index * slotSize);
  const durationDays = Math.max(7, Math.floor(slotSize * 0.8));

  const start = new Date(baseDate);
  start.setDate(start.getDate() + offsetDays);

  const end = new Date(start);
  end.setDate(end.getDate() + durationDays);

  return { start, end };
};

/**
 * Map work item type to Gantt task type.
 */
const mapWorkItemTypeToGanttType = (
  type: string
): "task" | "summary" | "milestone" => {
  switch (type) {
    case "epic":
    case "feature":
      return "summary";
    default:
      return "task";
  }
};

// ──────────────────────────────────────────────
// Scale presets
// ──────────────────────────────────────────────

const SCALE_PRESETS: GanttScalePresets = {
  week: [
    { unit: "week", step: 1, format: "'Week' W, MMM yyyy" },
    { unit: "day", step: 1, format: "EEE d" },
  ],
  month: [
    { unit: "month", step: 1, format: "MMMM yyyy" },
    { unit: "week", step: 1, format: "'W'W" },
  ],
  quarter: [
    { unit: "year", step: 1, format: "yyyy" },
    { unit: "month", step: 1, format: "MMM" },
  ],
};

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

export const useProjectRoadmap = (_projectId: string) => {
  const router = useRouter();
  const t = useTranslations("roadmap.gantt");
  const [zoomLevel, setZoomLevel] = useState<GanttZoomLevel>("month");
  const [colorMode, setColorMode] = useState<GanttColorMode>("status");

  // 1. Fetch all workspace boards (boards are org-scoped)
  const { data: boards, isLoading: isLoadingBoards } =
    useAllBoards();

  const boardsList = useMemo(() => boards ?? [], [boards]);

  // Build a lookup: boardId -> board (for column isDone info)
  const boardsMap = useMemo(() => {
    const map = new Map<string, BoardWithStats>();
    for (const board of boardsList) {
      map.set(board.id, board);
    }
    return map;
  }, [boardsList]);

  // 2. Fetch work items for each board
  const workItemQueries = useQueries({
    queries: boardsList.map((board) => ({
      queryKey: [...workItemKeys.all, "board", board.id, "gantt"],
      queryFn: () =>
        workItemsApi.getByBoard(board.id) as Promise<WorkItemWithRelations[]>,
      enabled: !!board.id,
      staleTime: 30_000,
    })),
  });

  const isLoadingWorkItems = workItemQueries.some((q) => q.isLoading);
  const isLoading = isLoadingBoards || isLoadingWorkItems;

  // 3. Flatten all work items from all boards
  const allWorkItems = useMemo(() => {
    const items: WorkItemWithRelations[] = [];
    for (const query of workItemQueries) {
      if (query.data && Array.isArray(query.data)) {
        items.push(...query.data);
      }
    }
    return items;
  }, [workItemQueries]);

  // 4. Build the UUID -> numeric ID map (stable across renders)
  const idMap = useMemo(() => {
    const map = new Map<string, number>();
    const usedIds = new Set<number>();

    for (const item of allWorkItems) {
      let numId = uuidToNumericId(item.id);
      // Handle collisions
      while (usedIds.has(numId)) {
        numId++;
      }
      usedIds.add(numId);
      map.set(item.id, numId);
    }
    return map;
  }, [allWorkItems]);

  // 5. Transform work items to GanttTask[]
  const tasks: GanttTask[] = useMemo(() => {
    if (allWorkItems.length === 0) return [];

    const baseDate = new Date();
    // Items without dates need an index for spreading
    let noDateIndex = 0;
    const noDateTotal = allWorkItems.filter(
      (wi) => !wi.dueDate
    ).length;

    // Build a set of parent IDs that have children (for progress calculation)
    const childrenByParent = new Map<string, WorkItemWithRelations[]>();
    for (const item of allWorkItems) {
      if (item.parentId) {
        const siblings = childrenByParent.get(item.parentId) ?? [];
        siblings.push(item);
        childrenByParent.set(item.parentId, siblings);
      }
    }

    return allWorkItems.map((item) => {
      const numericId = idMap.get(item.id) ?? uuidToNumericId(item.id);
      const parentNumericId = item.parentId
        ? idMap.get(item.parentId)
        : undefined;
      const ganttType = mapWorkItemTypeToGanttType(item.type);

      // Determine dates
      let start: Date;
      let end: Date;

      if (item.dueDate) {
        const due = new Date(item.dueDate);
        // Use dueDate as end, start = 7 days before
        end = due;
        start = new Date(due);
        start.setDate(start.getDate() - 7);
      } else {
        const defaults = generateDefaultDates(
          noDateIndex++,
          noDateTotal,
          baseDate
        );
        start = defaults.start;
        end = defaults.end;
      }

      // Determine color based on column status
      const board = boardsMap.get(item.boardId);
      const column = board?.columns.find((c) => c.id === item.boardColumnId);
      const isDone = column?.isDone ?? false;
      const color = getStatusColor(
        item.columnName ?? column?.name ?? "",
        isDone
      );

      // Calculate progress for parent items
      let progress = 0;
      if (ganttType === "summary") {
        const children = childrenByParent.get(item.id);
        if (children && children.length > 0) {
          const completedChildren = children.filter((child) => {
            const childBoard = boardsMap.get(child.boardId);
            const childCol = childBoard?.columns.find(
              (c) => c.id === child.boardColumnId
            );
            return childCol?.isDone ?? false;
          });
          progress = Math.round(
            (completedChildren.length / children.length) * 100
          );
        }
      } else if (isDone) {
        progress = 100;
      }

      const task: GanttTask = {
        id: numericId,
        text: item.title,
        start,
        end,
        progress,
        type: ganttType,
        parent: parentNumericId,
        open: ganttType === "summary",
        workItemId: item.id,
        workItemType:
          item.type === "epic" || item.type === "feature" || item.type === "story"
            ? item.type
            : undefined,
        color,
      };

      return task;
    });
  }, [allWorkItems, idMap, boardsMap]);

  // 6. Build GanttLink[] from dependencies
  // Dependencies are fetched per-item via a separate endpoint.
  // For the roadmap view, hierarchy is handled by the `parent` field on tasks.
  // In the future, if cross-item dependency data is available at the list level,
  // we can build finish-to-start links here.
  const links: GanttLink[] = useMemo(() => [], []);

  // 7. Compute scales based on zoom level
  const scales: IScaleConfig[] = useMemo(
    () => SCALE_PRESETS[zoomLevel],
    [zoomLevel]
  );

  // 8. Task click handler - navigate to the board with that item
  const onTaskClick = useCallback(
    (taskId: number) => {
      const item = allWorkItems.find(
        (wi) => idMap.get(wi.id) === taskId
      );
      if (!item) return;

      // Navigate to the board area that contains this work item
      const board = boardsMap.get(item.boardId);
      if (board) {
        router.push(`/board/${board.area}`);
      }
    },
    [allWorkItems, idMap, boardsMap, router]
  );

  const columns: GanttColumnConfig[] = useMemo(
    () => [{ id: "text", header: t("columnTask"), flexgrow: 1 }],
    [t]
  );

  return {
    tasks,
    links,
    scales,
    columns,
    zoomLevel,
    setZoomLevel,
    colorMode,
    setColorMode,
    isLoading,
    onTaskClick,
  };
};
