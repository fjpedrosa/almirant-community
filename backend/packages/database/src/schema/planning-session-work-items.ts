import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { planningSessions } from "./planning-sessions";
import { workItems } from "./work-items";

export const planningSessionWorkItems = pgTable(
  "planning_session_work_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => planningSessions.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    proposedInMessageId: uuid("proposed_in_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("planning_session_work_items_unique_idx").on(table.sessionId, table.workItemId),
  ]
);

export type PlanningSessionWorkItem = typeof planningSessionWorkItems.$inferSelect;
export type NewPlanningSessionWorkItem = typeof planningSessionWorkItems.$inferInsert;
