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

// Tracks which user has read which document (and when)
export const documentReads = pgTable(
  "document_reads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("document_reads_user_document_unique").on(table.userId, table.documentId),
    index("document_reads_user_idx").on(table.userId),
    index("document_reads_document_idx").on(table.documentId),
  ]
);

// Type exports
export type DocumentRead = typeof documentReads.$inferSelect;
export type NewDocumentRead = typeof documentReads.$inferInsert;
