import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workItemTypeEnum, priorityEnum, assigneeRoleEnum, codingAgentEnum } from "./enums";
import { projects } from "./projects";
import { boards, boardColumns } from "./boards";
import { tags } from "./tags";
import { user } from "./auth";

// Work items
export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "set null" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    boardColumnId: uuid("board_column_id")
      .references(() => boardColumns.id, { onDelete: "restrict" }),
    parentId: uuid("parent_id"),
    type: workItemTypeEnum("type").notNull().default("task"),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    priority: priorityEnum("priority").notNull().default("medium"),
    assignee: varchar("assignee", { length: 255 }),
    position: integer("position").notNull().default(0),
    startDate: timestamp("start_date", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    estimatedHours: integer("estimated_hours"),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    // True while an AI agent (via MCP) is actively working on this item.
    isAiProcessing: boolean("is_ai_processing").notNull().default(false),
    taskId: varchar("task_id", { length: 20 }).unique(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    requestedByUserId: text("requested_by_user_id").references(() => user.id, { onDelete: "set null" }),
    codingAgent: codingAgentEnum("coding_agent"),
    aiModel: varchar("ai_model", { length: 100 }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("work_items_board_column_position_idx").on(
      table.boardId,
      table.boardColumnId,
      table.position
    ),
    index("work_items_parent_idx").on(table.parentId),
    index("work_items_type_idx").on(table.type),
    index("work_items_priority_idx").on(table.priority),
    index("work_items_assignee_idx").on(table.assignee),
    index("work_items_archived_at_idx").on(table.archivedAt),
    index("work_items_task_id_idx").on(table.taskId),
    index("work_items_created_by_user_idx").on(table.createdByUserId),
    check(
      "work_items_type_board_column_check",
      sql`(
        (${table.type} IN ('task', 'idea') AND ${table.boardColumnId} IS NOT NULL)
        OR
        (${table.type} IN ('epic', 'feature', 'story') AND ${table.boardColumnId} IS NULL)
      )`
    ),
  ]
);

// Work item tags (many-to-many)
export const workItemTags = pgTable(
  "work_item_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("work_item_tags_unique_idx").on(table.workItemId, table.tagId),
  ]
);

// Work item assignees (many-to-many with user)
export const workItemAssignees = pgTable(
  "work_item_assignees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: assigneeRoleEnum("role").notNull().default("responsible"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("work_item_assignees_unique_idx").on(table.workItemId, table.userId),
    index("work_item_assignees_work_item_id_idx").on(table.workItemId),
    index("work_item_assignees_user_id_idx").on(table.userId),
  ]
);

// Type exports
export type WorkItemDb = typeof workItems.$inferSelect;
export type NewWorkItem = typeof workItems.$inferInsert;
export type WorkItemTag = typeof workItemTags.$inferSelect;
export type NewWorkItemTag = typeof workItemTags.$inferInsert;
export type WorkItemAssigneeDb = typeof workItemAssignees.$inferSelect;
export type NewWorkItemAssignee = typeof workItemAssignees.$inferInsert;
