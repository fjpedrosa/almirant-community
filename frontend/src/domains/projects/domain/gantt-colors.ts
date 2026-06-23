// ──────────────────────────────────────────────
// Gantt Chart Color Mapping
// ──────────────────────────────────────────────
// Pure functions for mapping work item column status to Gantt bar colors.
// No React imports, no hooks - domain layer only.

import type { WorkItemType } from "@/domains/work-items/domain/types";

/** Hex color constants used for Gantt chart task bars by status category */
export const GANTT_COLORS = {
  /** Tasks in completed/done columns */
  done: "#22c55e",
  /** Tasks in active progress columns */
  inProgress: "#f59e0b",
  /** Tasks in review/testing/validation columns */
  review: "#3b82f6",
  /** Tasks in backlog/to-do/not-started columns */
  notStarted: "#94a3b8",
} as const;

/** Type representing the available Gantt color scheme values */
export type GanttColorScheme = typeof GANTT_COLORS;

/** Hex color constants for Gantt chart task bars by work item type */
export const GANTT_TYPE_COLORS: Record<WorkItemType, string> = {
  epic: "#8b5cf6",
  feature: "#3b82f6",
  story: "#22c55e",
  task: "#f59e0b",
  idea: "#f97316",
} as const;

/**
 * Returns the Gantt bar color based on the work item type.
 *
 * @param type - The type of work item (epic, feature, story, task)
 * @returns A hex color string for the Gantt bar
 */
export const getGanttTaskColorByType = (type: WorkItemType): string =>
  GANTT_TYPE_COLORS[type];

// ── Column name patterns (case-insensitive) ──

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
];

const REVIEW_PATTERNS = [
  "review",
  "reviewing",
  "testing",
  "test",
  "qa",
  "validation",
  "validating",
  "verify",
  "verifying",
  "staging",
  "code review",
  "pr review",
  "pull request",
];

/**
 * Determines the Gantt bar color based on the board column name and done status.
 *
 * @param columnName - The name of the board column the work item belongs to
 * @param isDone - Whether the task is explicitly marked as done (overrides column matching)
 * @returns A hex color string for the Gantt bar
 */
export const getGanttTaskColor = (
  columnName: string,
  isDone: boolean,
): string => {
  if (isDone) {
    return GANTT_COLORS.done;
  }

  const normalized = columnName.toLowerCase().trim();

  if (DONE_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return GANTT_COLORS.done;
  }

  if (REVIEW_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return GANTT_COLORS.review;
  }

  if (IN_PROGRESS_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return GANTT_COLORS.inProgress;
  }

  // Default: not started (backlog, to do, pending, etc.)
  return GANTT_COLORS.notStarted;
};

/**
 * Calculates the progress percentage based on completed vs total children.
 *
 * @param completedChildren - Number of children tasks that are completed
 * @param totalChildren - Total number of children tasks
 * @returns A number between 0 and 100 representing the percentage
 */
export const calculateProgress = (
  completedChildren: number,
  totalChildren: number,
): number => {
  if (totalChildren <= 0) {
    return 0;
  }

  const clamped = Math.max(0, Math.min(completedChildren, totalChildren));
  return Math.round((clamped / totalChildren) * 100);
};
