import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { workItems } from "./work-items";

// Work item dependencies (many-to-many: "blocked by" relationship)
export const workItemDependencies = pgTable(
  "work_item_dependencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    blockedByWorkItemId: uuid("blocked_by_work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("work_item_dependencies_unique_idx").on(
      table.workItemId,
      table.blockedByWorkItemId
    ),
    index("work_item_dependencies_work_item_idx").on(table.workItemId),
    index("work_item_dependencies_blocked_by_idx").on(table.blockedByWorkItemId),
  ]
);

// Type exports
export type WorkItemDependency = typeof workItemDependencies.$inferSelect;
export type NewWorkItemDependency = typeof workItemDependencies.$inferInsert;
