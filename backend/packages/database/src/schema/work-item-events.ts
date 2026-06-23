import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { workItemEventTypeEnum, eventTriggeredByEnum } from "./enums";
import { workItems } from "./work-items";
import { user } from "./auth";
import type { ProvenanceMetadata } from "./provenance";

/** Typed metadata for work item events, extending the common provenance model */
export interface WorkItemEventMetadata extends ProvenanceMetadata {
  [key: string]: unknown;
}

// Work item events - tracks history of changes to work items
export const workItemEvents = pgTable(
  "work_item_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    eventType: workItemEventTypeEnum("event_type").notNull(),
    fieldName: varchar("field_name", { length: 100 }),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    triggeredBy: eventTriggeredByEnum("triggered_by").notNull().default("system"),
    triggeredByUserId: text("triggered_by_user_id")
      .references(() => user.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").default({}).$type<WorkItemEventMetadata>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("work_item_events_work_item_idx").on(table.workItemId),
    index("work_item_events_event_type_idx").on(table.eventType),
    index("work_item_events_triggered_by_user_idx").on(table.triggeredByUserId),
    index("work_item_events_created_at_idx").on(table.createdAt),
  ]
);

// Type exports
export type WorkItemEventDb = typeof workItemEvents.$inferSelect;
export type NewWorkItemEvent = typeof workItemEvents.$inferInsert;
