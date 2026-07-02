import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { milestoneStatusEnum, priorityEnum } from "./enums";
import { workspace } from "./workspace";
import { projects } from "./projects";
import { user } from "./auth";
import { workItems } from "./work-items";

// Milestones
export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    status: milestoneStatusEnum("status").notNull().default("planned"),
    priority: priorityEnum("priority").notNull().default("medium"),
    targetDate: timestamp("target_date", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("milestones_project_id_idx").on(table.projectId),
    index("milestones_workspace_id_idx").on(table.workspaceId),
    index("milestones_status_idx").on(table.status),
  ]
);

// Milestone work items (junction table)
export const milestoneWorkItems = pgTable(
  "milestone_work_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("milestone_work_items_unique_idx").on(table.milestoneId, table.workItemId),
    index("milestone_work_items_work_item_id_idx").on(table.workItemId),
  ]
);

export type MilestoneDb = typeof milestones.$inferSelect;
export type NewMilestone = typeof milestones.$inferInsert;
export type MilestoneWorkItemDb = typeof milestoneWorkItems.$inferSelect;
export type NewMilestoneWorkItem = typeof milestoneWorkItems.$inferInsert;
