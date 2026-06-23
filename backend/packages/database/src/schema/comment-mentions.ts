import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { ideaItemComments } from "./idea-item-comments";
import { ideaItems } from "./idea-items";
import { user } from "./auth";

export const commentMentions = pgTable(
  "comment_mentions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => ideaItemComments.id, { onDelete: "cascade" }),
    mentionedUserId: text("mentioned_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ideaItemId: uuid("idea_item_id")
      .notNull()
      .references(() => ideaItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("comment_mentions_comment_id_idx").on(table.commentId),
    index("comment_mentions_mentioned_user_id_idx").on(table.mentionedUserId),
    index("comment_mentions_idea_item_id_idx").on(table.ideaItemId),
  ]
);

export type CommentMention = typeof commentMentions.$inferSelect;
export type NewCommentMention = typeof commentMentions.$inferInsert;
