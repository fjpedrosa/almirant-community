import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { ideaItems } from "./idea-items";
import { user } from "./auth";

// Idea item events - tracks history of changes to ideas/todos
export const ideaItemEvents = pgTable(
  "idea_item_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ideaItemId: uuid("idea_item_id")
      .notNull()
      .references(() => ideaItems.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    fieldName: varchar("field_name", { length: 100 }),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    triggeredBy: varchar("triggered_by", { length: 30 }).notNull().default("system"),
    triggeredByUserId: text("triggered_by_user_id")
      .references(() => user.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idea_item_events_idea_item_idx").on(table.ideaItemId),
    index("idea_item_events_event_type_idx").on(table.eventType),
    index("idea_item_events_triggered_by_user_idx").on(table.triggeredByUserId),
    index("idea_item_events_created_at_idx").on(table.createdAt),
  ]
);

export type IdeaItemEventDb = typeof ideaItemEvents.$inferSelect;
export type NewIdeaItemEvent = typeof ideaItemEvents.$inferInsert;
