import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { user } from "./auth";

// Tracks which user has favorited which document (and when)
export const documentFavorites = pgTable(
  "document_favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("document_favorites_user_document_unique").on(table.userId, table.documentId),
    index("document_favorites_user_idx").on(table.userId),
    index("document_favorites_document_idx").on(table.documentId),
  ]
);

// Type exports
export type DocumentFavorite = typeof documentFavorites.$inferSelect;
export type NewDocumentFavorite = typeof documentFavorites.$inferInsert;
