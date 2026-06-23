import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { todoItems } from "./todo-items";
import { tags } from "./tags";

// Todo item tags (many-to-many)
export const todoItemTags = pgTable(
  "todo_item_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    todoItemId: uuid("todo_item_id")
      .notNull()
      .references(() => todoItems.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("todo_item_tags_unique_idx").on(table.todoItemId, table.tagId),
  ]
);

// Type exports
export type TodoItemTag = typeof todoItemTags.$inferSelect;
export type NewTodoItemTag = typeof todoItemTags.$inferInsert;
