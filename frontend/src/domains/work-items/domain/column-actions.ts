import type { ColumnRole } from "@/domains/boards/domain/types";

/** Action types available on work item cards */
export type ColumnActionType =
  | "copy-prompt"
  | "copy-saved-prompt"
  | "copy-implement-command"
  | "implement-with-ai"
  | "validate-with-ai"
  | "fix-with-ai"
  | "document-with-ai"
  | "info-popup"
  | "ai-review";

/** Runner action type - semantic action that maps to an agent job skill */
export type RunnerActionType = "implement" | "validate" | "fix" | "document";

/** Map from ColumnActionType to RunnerActionType (only for runner-capable actions) */
const ACTION_TO_RUNNER: Partial<Record<ColumnActionType, RunnerActionType>> = {
  "implement-with-ai": "implement",
  "validate-with-ai": "validate",
  "fix-with-ai": "fix",
  "document-with-ai": "document",
};

/** Get the RunnerActionType for a given ColumnActionType, if applicable */
export const getRunnerActionType = (action: ColumnActionType): RunnerActionType | null =>
  ACTION_TO_RUNNER[action] ?? null;

// ---------------------------------------------------------------------------
// Legacy name-based mapping (backwards compatibility)
// ---------------------------------------------------------------------------

/** Default actions available per column name (case-insensitive match) */
const COLUMN_ACTIONS_MAP: Record<string, ColumnActionType[]> = {
  backlog: ["copy-implement-command", "implement-with-ai", "info-popup"],
  "to do": ["copy-prompt", "copy-saved-prompt", "copy-implement-command", "implement-with-ai", "info-popup"],
  "in progress": ["copy-prompt", "copy-saved-prompt", "copy-implement-command", "implement-with-ai", "info-popup"],
  review: ["validate-with-ai", "ai-review", "info-popup"],
  reviewing: ["validate-with-ai", "ai-review", "info-popup"],
  "to review": ["validate-with-ai", "ai-review", "info-popup"],
  testing: ["info-popup"],
  validating: ["info-popup"],
  release: ["info-popup"],
  "to release": ["info-popup"],
  "to fix": ["info-popup"],
  "to document": ["info-popup"],
  "needs attention": ["info-popup"],
  approved: ["info-popup"],
  done: ["info-popup"],
};

/** Fallback actions when column name doesn't match any key */
const DEFAULT_ACTIONS: ColumnActionType[] = ["copy-prompt", "info-popup"];

/** Get available actions for a given column name */
export const getColumnActions = (columnName: string): ColumnActionType[] => {
  const key = columnName.toLowerCase();
  return COLUMN_ACTIONS_MAP[key] ?? DEFAULT_ACTIONS;
};

/** Check if a specific action is available for a column (name-based, legacy) */
export const isActionAvailable = (
  columnName: string,
  action: ColumnActionType
): boolean => {
  return getColumnActions(columnName).includes(action);
};

// ---------------------------------------------------------------------------
// Role-based mapping (preferred)
// ---------------------------------------------------------------------------

/** Actions available per column role */
const ROLE_ACTIONS_MAP: Record<ColumnRole, ColumnActionType[]> = {
  backlog: ["copy-implement-command", "implement-with-ai", "copy-prompt", "copy-saved-prompt", "info-popup"],
  todo: ["copy-implement-command", "implement-with-ai", "copy-prompt", "copy-saved-prompt", "info-popup"],
  in_progress: ["copy-implement-command", "implement-with-ai", "copy-prompt", "copy-saved-prompt", "info-popup"],
  review: ["validate-with-ai", "ai-review", "info-popup"],
  testing: ["info-popup"],
  needs_fix: ["info-popup"],
  validating: ["info-popup"],
  release: ["info-popup"],
  to_document: ["info-popup"],
  done: ["info-popup"],
  other: ["info-popup"],
};

/** Get available actions for a given column role */
export const getColumnActionsByRole = (role: ColumnRole): ColumnActionType[] => {
  return ROLE_ACTIONS_MAP[role] ?? ROLE_ACTIONS_MAP.other;
};

/** Check if a specific action is available for a column role */
export const isActionAvailableByRole = (
  role: ColumnRole,
  action: ColumnActionType
): boolean => {
  return getColumnActionsByRole(role).includes(action);
};

/** Get the primary runner action for a column role, if any */
export const getRunnerActionForRole = (role: ColumnRole): RunnerActionType | null => {
  const actions = getColumnActionsByRole(role);
  for (const action of actions) {
    const runner = getRunnerActionType(action);
    if (runner) return runner;
  }
  return null;
};

/** Get the ColumnActionType that triggers the runner for a role */
export const getRunnerColumnAction = (role: ColumnRole): ColumnActionType | null => {
  const actions = getColumnActionsByRole(role);
  for (const action of actions) {
    if (ACTION_TO_RUNNER[action]) return action;
  }
  return null;
};
