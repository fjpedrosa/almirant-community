import type { ColumnRole } from "./project-management.types";

/** The only supported workflow for boards in the `desarrollo` area. */
export interface DevelopmentBoardColumnDefinition {
  name: string;
  role: Extract<ColumnRole, "backlog" | "todo" | "in_progress" | "review" | "validating" | "release" | "done">;
  order: number;
  color: string;
  isDone: boolean;
}

export const DEVELOPMENT_BOARD_WORKFLOW: readonly DevelopmentBoardColumnDefinition[] = [
  { name: "Backlog", role: "backlog", order: 0, color: "#94a3b8", isDone: false },
  { name: "To Do", role: "todo", order: 1, color: "#6366f1", isDone: false },
  { name: "In Progress", role: "in_progress", order: 2, color: "#f59e0b", isDone: false },
  { name: "To Review", role: "review", order: 3, color: "#8b5cf6", isDone: false },
  { name: "Validating", role: "validating", order: 4, color: "#ec4899", isDone: false },
  { name: "To Release", role: "release", order: 5, color: "#a855f7", isDone: false },
  { name: "Done", role: "done", order: 6, color: "#22c55e", isDone: true },
] as const;

/** Return mutable rows suitable for inserts/templates without sharing state. */
export const getDevelopmentBoardColumns = (): DevelopmentBoardColumnDefinition[] =>
  DEVELOPMENT_BOARD_WORKFLOW.map((column) => ({ ...column }));
