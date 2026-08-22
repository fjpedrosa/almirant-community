import {
  pgTable,
  uuid,
  text,
  varchar,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentJobs } from "./agent-jobs";
import { workspace } from "./workspace";
import { user } from "./auth";
import { projects } from "./projects";
import { boards } from "./boards";
import { planningSessions } from "./planning-sessions";

export const planReviewAdmissions = pgTable("plan_review_admissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  planningSessionId: uuid("planning_session_id").notNull().references(() => planningSessions.id, { onDelete: "cascade" }),
  requestedByUserId: text("requested_by_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  reviewJobId: uuid("review_job_id").notNull().references(() => agentJobs.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  boardColumnId: text("board_column_id").notNull(),
  planSha256: varchar("plan_sha256", { length: 64 }).notNull(),
  snapshot: jsonb("snapshot").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("queued"),
  result: jsonb("result"),
  applicationLeaseId: uuid("application_lease_id"),
  applicationLeaseAcquiredAt: timestamp("application_lease_acquired_at", { withTimezone: true }),
  applicationLeaseExpiresAt: timestamp("application_lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("plan_review_admissions_workspace_session_plan_uidx").on(table.workspaceId, table.planningSessionId, table.planSha256),
  uniqueIndex("plan_review_admissions_review_job_uidx").on(table.reviewJobId),
  index("plan_review_admissions_workspace_session_created_idx").on(table.workspaceId, table.planningSessionId, table.createdAt),
  index("plan_review_admissions_status_idx").on(table.status),
  check("plan_review_admissions_sha256_check", sql`${table.planSha256} ~ '^[a-f0-9]{64}$'`),
]);

export type PlanReviewAdmissionDb = typeof planReviewAdmissions.$inferSelect;
export type NewPlanReviewAdmission = typeof planReviewAdmissions.$inferInsert;
