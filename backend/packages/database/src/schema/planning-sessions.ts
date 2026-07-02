import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { planningSessionStatusEnum } from "./enums";
import { projects } from "./projects";
import { boards } from "./boards";
import { workspace } from "./workspace";
import { user } from "./auth";

export interface PlanningSessionConfig {
  model?: string;
  provider?: string;
  systemPrompt?: string;
  temperature?: number;
}

export interface InterruptionContext {
  reason: string;
  lastPhase: string;
  pendingQuestionText?: string;
  pendingQuestionOptions?: string[];
  workItemsCreatedSoFar: number;
  seedsProcessedSoFar: number;
  lastJobId: string;
  interruptedAt: string;
}

export interface PlanningSessionResult {
  summary?: string;
  reason?: string;
  workItemsCreated?: number;
  seedsProcessed?: number;
  interruptionContext?: InterruptionContext;
}

export const planningSessions = pgTable(
  "planning_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "set null" }),
    boardId: uuid("board_id")
      .references(() => boards.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: planningSessionStatusEnum("status").notNull().default("active"),
    config: jsonb("config").default({}).$type<PlanningSessionConfig>(),
    result: jsonb("result").$type<PlanningSessionResult>(),
    createdByUserId: text("created_by_user_id")
      .references(() => user.id, { onDelete: "set null" }),
    totalInputTokens: integer("total_input_tokens").default(0),
    totalOutputTokens: integer("total_output_tokens").default(0),
    estimatedCost: numeric("estimated_cost", { precision: 10, scale: 6 }),
    durationMs: integer("duration_ms"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("planning_sessions_workspace_idx").on(table.workspaceId),
    index("planning_sessions_project_idx").on(table.projectId),
    index("planning_sessions_board_idx").on(table.boardId),
    index("planning_sessions_status_idx").on(table.status),
    index("planning_sessions_created_by_idx").on(table.createdByUserId),
    index("planning_sessions_created_at_idx").on(table.createdAt),
    index("planning_sessions_project_created_idx").on(table.projectId, table.createdAt),
  ]
);

export type PlanningSession = typeof planningSessions.$inferSelect;
export type NewPlanningSession = typeof planningSessions.$inferInsert;
