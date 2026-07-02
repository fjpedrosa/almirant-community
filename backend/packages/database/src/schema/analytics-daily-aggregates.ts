import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspace } from "./workspace";

export const analyticsDailyAggregates = pgTable(
  "analytics_daily_aggregates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    date: timestamp("date").notNull(),
    totalJobs: integer("total_jobs").notNull().default(0),
    completedJobs: integer("completed_jobs").notNull().default(0),
    failedJobs: integer("failed_jobs").notNull().default(0),
    totalDurationSeconds: integer("total_duration_seconds")
      .notNull()
      .default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }),
    totalCost: numeric("total_cost", { precision: 12, scale: 6 }),
    activeUsers: integer("active_users").notNull().default(0),
    byModel: jsonb("by_model").$type<Record<string, unknown>>(),
    byCodingAgent: jsonb("by_coding_agent").$type<Record<string, unknown>>(),
    byAiProvider: jsonb("by_ai_provider").$type<Record<string, unknown>>(),
    byJobType: jsonb("by_job_type").$type<Record<string, unknown>>(),
    byProject: jsonb("by_project").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("analytics_daily_aggregates_org_date_idx").on(
      table.workspaceId,
      table.date
    ),
    index("analytics_daily_aggregates_org_idx").on(table.workspaceId),
    index("analytics_daily_aggregates_date_idx").on(table.date),
  ]
);

export const analyticsDailyUserAggregates = pgTable(
  "analytics_daily_user_aggregates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: timestamp("date").notNull(),
    totalJobs: integer("total_jobs").notNull().default(0),
    completedJobs: integer("completed_jobs").notNull().default(0),
    failedJobs: integer("failed_jobs").notNull().default(0),
    totalDurationSeconds: integer("total_duration_seconds")
      .notNull()
      .default(0),
    totalTokens: bigint("total_tokens", { mode: "number" }),
    totalCost: numeric("total_cost", { precision: 12, scale: 6 }),
    activeUsers: integer("active_users").notNull().default(0),
    byModel: jsonb("by_model").$type<Record<string, unknown>>(),
    byCodingAgent: jsonb("by_coding_agent").$type<Record<string, unknown>>(),
    byAiProvider: jsonb("by_ai_provider").$type<Record<string, unknown>>(),
    byJobType: jsonb("by_job_type").$type<Record<string, unknown>>(),
    byProject: jsonb("by_project").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("analytics_daily_user_aggregates_org_user_date_idx").on(
      table.workspaceId,
      table.userId,
      table.date
    ),
    index("analytics_daily_user_aggregates_org_idx").on(table.workspaceId),
    index("analytics_daily_user_aggregates_user_idx").on(table.userId),
    index("analytics_daily_user_aggregates_date_idx").on(table.date),
  ]
);

export type AnalyticsDailyAggregateDb =
  typeof analyticsDailyAggregates.$inferSelect;
export type NewAnalyticsDailyAggregate =
  typeof analyticsDailyAggregates.$inferInsert;
export type AnalyticsDailyUserAggregateDb =
  typeof analyticsDailyUserAggregates.$inferSelect;
export type NewAnalyticsDailyUserAggregate =
  typeof analyticsDailyUserAggregates.$inferInsert;
