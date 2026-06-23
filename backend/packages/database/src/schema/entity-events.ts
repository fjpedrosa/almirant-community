import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { entityTypeEnum } from "./enums";
import { user } from "./auth";

// Entity events - polymorphic audit trail for ideas and todos
export const entityEvents = pgTable(
  "entity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(), // No FK - polymorphic reference
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
    index("entity_events_entity_type_entity_id_idx").on(table.entityType, table.entityId),
    index("entity_events_event_type_idx").on(table.eventType),
    index("entity_events_triggered_by_user_idx").on(table.triggeredByUserId),
    index("entity_events_created_at_idx").on(table.createdAt),
  ]
);

// Type exports
export type EntityEventDb = typeof entityEvents.$inferSelect;
export type NewEntityEvent = typeof entityEvents.$inferInsert;
