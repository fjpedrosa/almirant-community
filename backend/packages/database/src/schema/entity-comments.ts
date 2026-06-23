import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { entityTypeEnum } from "./enums";
import { user } from "./auth";

export const entityComments = pgTable(
  "entity_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("entity_comments_entity_type_entity_id_idx").on(table.entityType, table.entityId),
    index("entity_comments_user_id_idx").on(table.userId),
    index("entity_comments_created_at_idx").on(table.createdAt),
  ]
);

export type EntityComment = typeof entityComments.$inferSelect;
export type NewEntityComment = typeof entityComments.$inferInsert;
