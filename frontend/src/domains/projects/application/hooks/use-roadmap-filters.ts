"use client";

import { useState, useMemo, useCallback } from "react";
import type {
  RoadmapFilters,
  RoadmapStatusFilter,
  RoadmapEpic,
  RoadmapFeature,
  RoadmapItem,
  ProjectRoadmapData,
  SelectOption,
  Project,
} from "../../domain/types";

// ──────────────────────────────────────────────
// Column name patterns for status classification
// ──────────────────────────────────────────────

const DONE_PATTERNS = [
  "done",
  "completed",
  "complete",
  "finished",
  "closed",
  "resolved",
  "deployed",
  "released",
  "shipped",
];

const IN_PROGRESS_PATTERNS = [
  "in progress",
  "in-progress",
  "inprogress",
  "doing",
  "working",
  "active",
  "development",
  "developing",
  "implementation",
  "implementing",
  "coding",
  "wip",
  "in dev",
  "review",
  "reviewing",
  "testing",
  "test",
  "qa",
  "validation",
];

// ──────────────────────────────────────────────
// Pure functions for filtering
// ──────────────────────────────────────────────

/**
 * Classify a roadmap item's status based on its column name and dates.
 */
const classifyItemStatus = (
  item: RoadmapItem
): "completed" | "in-progress" | "planned" => {
  const normalizedColumn = item.columnName.toLowerCase().trim();

  if (DONE_PATTERNS.some((p) => normalizedColumn.includes(p))) {
    return "completed";
  }

  if (IN_PROGRESS_PATTERNS.some((p) => normalizedColumn.includes(p))) {
    return "in-progress";
  }

  return "planned";
};

/**
 * Check if an item (or any of its descendants) falls within a date range.
 */
const isItemInDateRange = (
  item: RoadmapItem,
  from: Date | null,
  to: Date | null
): boolean => {
  if (!from && !to) return true;

  const itemStart = item.startDate ? new Date(item.startDate) : null;
  const itemEnd = item.endDate ? new Date(item.endDate) : null;

  // If item has no dates at all, include it (don't filter out undated items)
  if (!itemStart && !itemEnd) return true;

  if (from && itemEnd) {
    // Item ends before our range starts -> exclude
    if (itemEnd < from) return false;
  }

  if (to && itemStart) {
    // Item starts after our range ends -> exclude
    if (itemStart > to) return false;
  }

  return true;
};

/**
 * Check if an item matches the status filter.
 */
const itemMatchesStatus = (
  item: RoadmapItem,
  status: RoadmapStatusFilter
): boolean => {
  if (status === "all") return true;
  return classifyItemStatus(item) === status;
};

/**
 * Filter the hierarchical roadmap data based on active filters.
 * Returns a new filtered copy without mutating the original data.
 */
export const filterRoadmapData = (
  data: ProjectRoadmapData | null,
  filters: RoadmapFilters
): ProjectRoadmapData | null => {
  if (!data) return null;

  const { epicId, dateRange, status } = filters;

  let epics = data.epics;

  // Filter by specific epic
  if (epicId) {
    epics = epics.filter((epic) => epic.id === epicId);
  }

  // Apply status and date range filters to the hierarchy
  const filteredEpics: RoadmapEpic[] = epics
    .map((epic) => {
      // Filter features within epic
      const filteredFeatures: RoadmapFeature[] = epic.children
        .map((feature) => {
          // Filter stories/tasks within feature
          const filteredStories: RoadmapItem[] = feature.children.filter(
            (story) =>
              itemMatchesStatus(story, status) &&
              isItemInDateRange(story, dateRange.from, dateRange.to)
          );

          return {
            ...feature,
            children: filteredStories,
          };
        })
        .filter((feature) => {
          // Keep feature if it has matching children OR if it itself matches
          const featureMatches =
            itemMatchesStatus(feature, status) &&
            isItemInDateRange(feature, dateRange.from, dateRange.to);

          return feature.children.length > 0 || featureMatches;
        });

      return {
        ...epic,
        children: filteredFeatures,
      };
    })
    .filter((epic) => {
      // Keep epic if it has matching children OR if it itself matches
      const epicMatches =
        itemMatchesStatus(epic, status) &&
        isItemInDateRange(epic, dateRange.from, dateRange.to);

      return epic.children.length > 0 || epicMatches;
    });

  return {
    ...data,
    epics: filteredEpics,
  };
};

// ──────────────────────────────────────────────
// Default filter state
// ──────────────────────────────────────────────

const DEFAULT_FILTERS: RoadmapFilters = {
  projectId: undefined,
  epicId: undefined,
  dateRange: { from: null, to: null },
  status: "all",
};

// ──────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────

export const useRoadmapFilters = (
  projects: Project[],
  roadmapData: ProjectRoadmapData | null
) => {
  const [filters, setFilters] = useState<RoadmapFilters>(DEFAULT_FILTERS);

  // Build project options for the select dropdown
  const projectOptions: SelectOption[] = useMemo(
    () =>
      projects.map((p) => ({
        value: p.id,
        label: p.name,
      })),
    [projects]
  );

  // Build epic options from the roadmap data (filtered by selected project)
  const epicOptions: SelectOption[] = useMemo(() => {
    if (!roadmapData) return [];

    return roadmapData.epics.map((epic) => ({
      value: epic.id,
      label: epic.title,
    }));
  }, [roadmapData]);

  // Filtered roadmap data
  const filteredData = useMemo(
    () => filterRoadmapData(roadmapData, filters),
    [roadmapData, filters]
  );

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.projectId ||
      filters.epicId ||
      filters.dateRange.from ||
      filters.dateRange.to ||
      filters.status !== "all"
    );
  }, [filters]);

  // ── Handlers ──

  const setProjectId = useCallback((value: string | undefined) => {
    setFilters((prev) => ({
      ...prev,
      projectId: value,
      // Reset epic when project changes
      epicId: undefined,
    }));
  }, []);

  const setEpicId = useCallback((value: string | undefined) => {
    setFilters((prev) => ({
      ...prev,
      epicId: value,
    }));
  }, []);

  const setDateFrom = useCallback((date: Date | null) => {
    setFilters((prev) => ({
      ...prev,
      dateRange: { ...prev.dateRange, from: date },
    }));
  }, []);

  const setDateTo = useCallback((date: Date | null) => {
    setFilters((prev) => ({
      ...prev,
      dateRange: { ...prev.dateRange, to: date },
    }));
  }, []);

  const setStatus = useCallback((value: RoadmapStatusFilter) => {
    setFilters((prev) => ({
      ...prev,
      status: value,
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  return {
    filters,
    filteredData,
    projectOptions,
    epicOptions,
    hasActiveFilters,
    setProjectId,
    setEpicId,
    setDateFrom,
    setDateTo,
    setStatus,
    clearFilters,
  };
};
