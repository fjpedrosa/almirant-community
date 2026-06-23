import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ideaItems } from "./idea-items";
import { tags } from "./tags";

// Idea item tags (many-to-many)
export const ideaItemTags = pgTable(
  "idea_item_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ideaItemId: uuid("idea_item_id")
      .notNull()
      .references(() => ideaItems.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idea_item_tags_unique_idx").on(table.ideaItemId, table.tagId),
  ]
);

// Type exports
export type IdeaItemTag = typeof ideaItemTags.$inferSelect;
export type NewIdeaItemTag = typeof ideaItemTags.$inferInsert;
