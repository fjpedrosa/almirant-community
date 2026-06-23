"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { format as formatDate, getWeek } from "date-fns";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { projectsApi, workItemsApi } from "@/lib/api/client";
import { useRoadmapFilters } from "./use-roadmap-filters";
import { getGanttTaskColor, getGanttTaskColorByType, calculateProgress } from "../../domain/gantt-colors";
import type {
  Project,
  ProjectRoadmapData,
  RoadmapItem,
  GanttTask,
  GanttLink,
  GanttZoomLevel,
  GanttColorMode,
  GanttColumnConfig,
  GanttScalePresets,
} from "../../domain/types";
import type { WorkItemType } from "@/domains/work-items/domain/types";
import type { IScaleConfig } from "@svar-ui/react-gantt";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Deterministic numeric hash from a UUID string.
 * @svar-ui/react-gantt uses numeric IDs.
 */
const uuidToNumericId = (uuid: string): number => {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const char = uuid.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
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
  const windowDays = 90;
  const slotSize = total > 1 ? windowDays / total : 14;
  const offsetDays = Math.floor(index * slotSize);
  const durationDays = Math.max(7, Math.floor(slotSize * 0.8));

  const start = new Date(baseDate);
  start.setDate(start.getDate() + offsetDays);

  const end = new Date(start);
  end.setDate(end.getDate() + durationDays);

  return { start, end };
};

// ──────────────────────────────────────────────
// Scale presets
// ──────────────────────────────────────────────

// Note: dateOpts is now created inside the hook to use the locale from useFormattedDate

// DEFAULT_COLUMNS removed – translated columns are built inside the hook via useTranslations.

// ──────────────────────────────────────────────
// Roadmap query keys
// ──────────────────────────────────────────────

export const roadmapKeys = {
  all: ["roadmap"] as const,
  byProject: (projectId: string) => [...roadmapKeys.all, projectId] as const,
};

// ──────────────────────────────────────────────
// Flatten roadmap hierarchy into a flat list for Gantt rendering
// ──────────────────────────────────────────────

interface FlatItem {
  item: RoadmapItem;
  parentId: string | null;
  ganttType: "task" | "summary" | "milestone";
  childCount: number;
  doneChildCount: number;
}

const DONE_PATTERNS = [
  "done", "completed", "complete", "finished",
  "closed", "resolved", "deployed", "released", "shipped",
];

const isDoneByColumn = (columnName?: string | null): boolean => {
  const normalized = (columnName ?? "").toLowerCase().trim();
  return DONE_PATTERNS.some((p) => normalized.includes(p));
};

const flattenRoadmap = (data: ProjectRoadmapData): FlatItem[] => {
  const result: FlatItem[] = [];

  for (const epic of data.epics) {
    const epicChildren = epic.children ?? [];

    // Count done features for epic progress
    const epicDoneChildren = epicChildren.filter((f) =>
      isDoneByColumn(f.columnName)
    ).length;

    result.push({
      item: epic,
      parentId: null,
      ganttType: "summary",
      childCount: epicChildren.length,
      doneChildCount: epicDoneChildren,
    });

    for (const feature of epicChildren) {
      const featureChildren = feature.children ?? [];

      // Count done stories for feature progress
      const featureDoneChildren = featureChildren.filter((s) =>
        isDoneByColumn(s.columnName)
      ).length;

      result.push({
        item: feature,
        parentId: epic.id,
        ganttType: "summary",
        childCount: featureChildren.length,
        doneChildCount: featureDoneChildren,
      });

      for (const story of featureChildren) {
        result.push({
          item: story,
          parentId: feature.id,
          ganttType: "task",
          childCount: 0,
          doneChildCount: 0,
        });
      }
    }
  }

  return result;
};

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

export const useRoadmapPage = () => {
  const router = useRouter();
  const t = useTranslations("roadmap.gantt");
  const { locale } = useFormattedDate();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<GanttZoomLevel>("month");
  const [colorMode, setColorMode] = useState<GanttColorMode>("status");
  const [allExpanded, setAllExpanded] = useState(true);

  const toggleAllExpanded = useCallback(() => setAllExpanded((prev) => !prev), []);

  // Scale presets with locale support
  const SCALE_PRESETS: GanttScalePresets = useMemo(() => {
    const dateOpts = { locale };
    return {
      week: [
        { unit: "week", step: 1, format: (start: Date) => `Sem ${getWeek(start)}, ${formatDate(start, "MMM yyyy", dateOpts)}` },
        { unit: "day", step: 1, format: (start: Date) => formatDate(start, "EEE d", dateOpts) },
      ],
      month: [
        { unit: "month", step: 1, format: (start: Date) => formatDate(start, "MMMM yyyy", dateOpts) },
        { unit: "week", step: 1, format: (start: Date) => `S${getWeek(start)}` },
      ],
      quarter: [
        { unit: "year", step: 1, format: (start: Date) => formatDate(start, "yyyy", dateOpts) },
        { unit: "month", step: 1, format: (start: Date) => formatDate(start, "MMM", dateOpts) },
      ],
    };
  }, [locale]);

  // 1. Fetch all projects for the selector
  const { data: projectsData, isLoading: isLoadingProjects } = useQuery({
    queryKey: ["projects", "list", ""],
    queryFn: () => projectsApi.list() as Promise<Project[]>,
  });

  const projects = useMemo(() => projectsData ?? [], [projectsData]);

  // Auto-select first project if none selected
  const effectiveProjectId = useMemo(() => {
    if (selectedProjectId) return selectedProjectId;
    if (projects.length > 0) return projects[0].id;
    return null;
  }, [selectedProjectId, projects]);

  // 2. Fetch roadmap data for selected project
  const { data: roadmapData, isLoading: isLoadingRoadmap } = useQuery({
    queryKey: roadmapKeys.byProject(effectiveProjectId ?? ""),
    queryFn: () =>
      projectsApi.getRoadmap(effectiveProjectId!) as Promise<ProjectRoadmapData>,
    enabled: !!effectiveProjectId,
    staleTime: 30_000,
  });

  // 3. Filters
  const {
    filters,
    filteredData,
    projectOptions,
    epicOptions,
    hasActiveFilters,
    setEpicId,
    setDateFrom,
    setDateTo,
    setStatus,
    clearFilters,
  } = useRoadmapFilters(projects, roadmapData ?? null);

  // 4. Build Gantt ID map and tasks from filtered data
  const flatItems = useMemo(() => {
    if (!filteredData) return [];
    return flattenRoadmap(filteredData);
  }, [filteredData]);

  const idMap = useMemo(() => {
    const map = new Map<string, number>();
    const usedIds = new Set<number>();

    for (const { item } of flatItems) {
      let numId = uuidToNumericId(item.id);
      while (usedIds.has(numId)) {
        numId++;
      }
      usedIds.add(numId);
      map.set(item.id, numId);
    }
    return map;
  }, [flatItems]);

  // Reverse map: numeric Gantt ID → UUID for persisting drag changes
  const reverseIdMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const [uuid, numId] of idMap) {
      map.set(numId, uuid);
    }
    return map;
  }, [idMap]);

  const tasks: GanttTask[] = useMemo(() => {
    if (flatItems.length === 0) return [];

    const baseDate = new Date();
    let noDateIndex = 0;
    const noDateTotal = flatItems.filter(
      ({ item }) => !item.startDate && !item.endDate
    ).length;

    return flatItems.map(({ item, parentId, ganttType, childCount, doneChildCount }) => {
      const numericId = idMap.get(item.id) ?? uuidToNumericId(item.id);
      const parentNumericId = parentId ? idMap.get(parentId) : undefined;

      // Determine dates
      let start: Date;
      let end: Date;

      if (item.startDate || item.endDate) {
        start = item.startDate
          ? new Date(item.startDate)
          : new Date(item.endDate!);
        end = item.endDate
          ? new Date(item.endDate)
          : new Date(item.startDate!);

        // Ensure minimum 1-day duration
        if (start >= end) {
          end = new Date(start);
          end.setDate(end.getDate() + 7);
        }
      } else {
        const defaults = generateDefaultDates(
          noDateIndex++,
          noDateTotal,
          baseDate
        );
        start = defaults.start;
        end = defaults.end;
      }

      // Color based on selected mode
      const done = isDoneByColumn(item.columnName);
      const color = colorMode === "type"
        ? getGanttTaskColorByType(item.type as WorkItemType)
        : getGanttTaskColor(item.columnName, done);

      // Progress
      let progress = 0;
      if (ganttType === "summary" && childCount > 0) {
        progress = calculateProgress(doneChildCount, childCount);
      } else if (done) {
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
        // Avoid opening empty summary nodes: the gantt store expects child data
        // when `open === true` and crashes if the summary has no children.
        open: ganttType === "summary" && childCount > 0 && allExpanded,
        workItemId: item.id,
        workItemType:
          item.type === "epic" || item.type === "feature" || item.type === "story"
            ? item.type
            : undefined,
        color,
      };

      return task;
    });
  }, [flatItems, idMap, colorMode, allExpanded]);

  // 5. Links (empty for now, future: dependency links)
  const links: GanttLink[] = useMemo(() => [], []);

  // 6. Scales
  const scales: IScaleConfig[] = useMemo(
    () => SCALE_PRESETS[zoomLevel],
    [SCALE_PRESETS, zoomLevel]
  );

  // 7. Task click -> navigate to board
  const onTaskClick = useCallback(
    (taskId: number) => {
      const flatItem = flatItems.find(
        ({ item }) => idMap.get(item.id) === taskId
      );
      if (!flatItem) return;

      // Navigate to the project detail page
      if (effectiveProjectId) {
        router.push(`/projects/${effectiveProjectId}`);
      }
    },
    [flatItems, idMap, effectiveProjectId, router]
  );

  // 8. Project selection handler
  const handleProjectChange = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      clearFilters();
    },
    [clearFilters]
  );

  // Keep the filter project selector in sync with the main project selection.
  const handleFilterProjectChange = useCallback(
    (projectId: string | undefined) => {
      if (!projectId) return;
      handleProjectChange(projectId);
    },
    [handleProjectChange]
  );

  // 9. Drag & drop date persistence
  const queryClient = useQueryClient();

  const updateDatesMutation = useMutation({
    mutationFn: async (params: { workItemId: string; startDate: string; dueDate: string }) => {
      return workItemsApi.update(params.workItemId, {
        startDate: params.startDate,
        dueDate: params.dueDate,
      });
    },
    onSuccess: () => {
      if (effectiveProjectId) {
        queryClient.invalidateQueries({ queryKey: roadmapKeys.byProject(effectiveProjectId) });
      }
    },
  });

  const handleTaskDateChange = useCallback(
    (data: { taskId: number; start: Date; end: Date }) => {
      const workItemId = reverseIdMap.get(data.taskId);
      if (!workItemId) return;

      updateDatesMutation.mutate({
        workItemId,
        startDate: data.start.toISOString(),
        dueDate: data.end.toISOString(),
      });
    },
    [reverseIdMap, updateDatesMutation]
  );

  const isLoading = isLoadingProjects || isLoadingRoadmap;

  const columns: GanttColumnConfig[] = useMemo(
    () => [{ id: "text", header: t("columnTask"), flexgrow: 1 }],
    [t]
  );

  return {
    // Project selection
    projects,
    selectedProjectId: effectiveProjectId,
    isLoadingProjects,
    handleProjectChange,
    // Gantt data
    tasks,
    links,
    scales,
    columns,
    zoomLevel,
    setZoomLevel,
    colorMode,
    setColorMode,
    allExpanded,
    toggleAllExpanded,
    onTaskClick,
    handleTaskDateChange,
    isLoading,
    // Filters
    filters,
    filteredData,
    projectOptions,
    epicOptions,
    hasActiveFilters,
    setFilterProjectId: handleFilterProjectChange,
    setEpicId,
    setDateFrom,
    setDateTo,
    setStatus,
    clearFilters,
  };
};
