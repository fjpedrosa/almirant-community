import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { entityTypeEnum } from "./enums";

export const commentVersions = pgTable(
  "comment_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    commentId: uuid("comment_id").notNull(),
    entityType: entityTypeEnum("entity_type").notNull(),
    content: text("content").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }).defaultNow().notNull(),
    editedByUserId: text("edited_by_user_id").notNull(),
  },
  (table) => [
    index("comment_versions_comment_id_idx").on(table.commentId),
    index("comment_versions_edited_at_idx").on(table.editedAt),
  ]
);

export type CommentVersion = typeof commentVersions.$inferSelect;
export type NewCommentVersion = typeof commentVersions.$inferInsert;
