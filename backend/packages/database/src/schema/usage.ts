import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usageSessionTypeEnum } from "./enums";
import { user } from "./auth";
import { workspace } from "./workspace";
import { projects } from "./projects";

// Individual usage events
export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    jobId: uuid("job_id"), // nullable, references agent_jobs but no FK constraint to keep decoupled
    sessionType: usageSessionTypeEnum("session_type").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    tokensUsed: bigint("tokens_used", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("usage_records_org_idx").on(table.workspaceId),
    index("usage_records_user_idx").on(table.userId),
    index("usage_records_project_idx").on(table.projectId),
    index("usage_records_session_type_idx").on(table.sessionType),
    index("usage_records_started_at_idx").on(table.startedAt),
  ]
);

// Aggregated usage per org/period
export const usageSummaries = pgTable(
  "usage_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    period: varchar("period", { length: 7 }).notNull(), // "2026-03" format
    totalSeconds: integer("total_seconds").notNull().default(0),
    totalJobs: integer("total_jobs").notNull().default(0),
    implementSeconds: integer("implement_seconds").notNull().default(0),
    validateSeconds: integer("validate_seconds").notNull().default(0),
    planningSeconds: integer("planning_seconds").notNull().default(0),
    reviewSeconds: integer("review_seconds").notNull().default(0),
    chatSeconds: integer("chat_seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("usage_summaries_org_period_idx").on(
      table.workspaceId,
      table.period
    ),
    index("usage_summaries_org_idx").on(table.workspaceId),
  ]
);

// Aggregated usage per user/org/period
export const userUsageSummaries = pgTable(
  "user_usage_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    period: varchar("period", { length: 7 }).notNull(), // "2026-03" format
    totalSeconds: integer("total_seconds").notNull().default(0),
    totalJobs: integer("total_jobs").notNull().default(0),
    implementSeconds: integer("implement_seconds").notNull().default(0),
    validateSeconds: integer("validate_seconds").notNull().default(0),
    planningSeconds: integer("planning_seconds").notNull().default(0),
    reviewSeconds: integer("review_seconds").notNull().default(0),
    chatSeconds: integer("chat_seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_usage_summaries_org_user_period_idx").on(
      table.workspaceId,
      table.userId,
      table.period
    ),
    index("user_usage_summaries_org_idx").on(table.workspaceId),
    index("user_usage_summaries_user_idx").on(table.userId),
  ]
);

// Type exports
export type UsageRecordDb = typeof usageRecords.$inferSelect;
export type NewUsageRecord = typeof usageRecords.$inferInsert;
export type UsageSummaryDb = typeof usageSummaries.$inferSelect;
export type NewUsageSummary = typeof usageSummaries.$inferInsert;
export type UserUsageSummaryDb = typeof userUsageSummaries.$inferSelect;
export type NewUserUsageSummary = typeof userUsageSummaries.$inferInsert;
