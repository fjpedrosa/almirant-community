import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { ideaItems } from "./idea-items";
import { user } from "./auth";

export const ideaItemComments = pgTable(
  "idea_item_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ideaItemId: uuid("idea_item_id")
      .notNull()
      .references(() => ideaItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idea_item_comments_idea_item_id_idx").on(table.ideaItemId),
  ]
);

export type IdeaItemComment = typeof ideaItemComments.$inferSelect;
export type NewIdeaItemComment = typeof ideaItemComments.$inferInsert;
