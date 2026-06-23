import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sprintStatusEnum } from "./enums";
import { boards } from "./boards";
import { workItems } from "./work-items";

// Sprints
export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    status: sprintStatusEnum("status").notNull().default("open"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("sprints_board_id_idx").on(table.boardId),
    index("sprints_status_idx").on(table.status),
  ]
);

// Sprint work items (junction table)
export const sprintWorkItems = pgTable(
  "sprint_work_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sprint_work_items_unique_idx").on(table.sprintId, table.workItemId),
  ]
);

// Type exports
export type SprintDb = typeof sprints.$inferSelect;
export type NewSprint = typeof sprints.$inferInsert;
export type SprintWorkItemDb = typeof sprintWorkItems.$inferSelect;
export type NewSprintWorkItem = typeof sprintWorkItems.$inferInsert;
