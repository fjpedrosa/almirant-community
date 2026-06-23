import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { todoItemStatusEnum, priorityEnum } from "./enums";
import { projects } from "./projects";
import { organization } from "./organization";
import { user } from "./auth";

export const todoItems = pgTable(
  "todo_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: todoItemStatusEnum("status").notNull().default("pending"),
    priority: priorityEnum("priority"),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("todo_items_organization_idx").on(table.organizationId),
    index("todo_items_project_idx").on(table.projectId),
    index("todo_items_owner_user_idx").on(table.ownerUserId),
    index("todo_items_created_by_user_idx").on(table.createdByUserId),
    index("todo_items_status_idx").on(table.status),
    index("todo_items_due_date_idx").on(table.dueDate),
    index("todo_items_completed_at_idx").on(table.completedAt),
  ]
);

export type TodoItemDb = typeof todoItems.$inferSelect;
export type NewTodoItem = typeof todoItems.$inferInsert;
