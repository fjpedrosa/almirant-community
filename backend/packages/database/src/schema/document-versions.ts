import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .references(() => documents.id, { onDelete: "cascade" })
      .notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    s3Key: text("s3_key").notNull(),
    commitSha: varchar("commit_sha", { length: 40 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("document_versions_document_id_idx").on(table.documentId),
    index("document_versions_content_hash_idx").on(table.contentHash),
    index("document_versions_commit_sha_idx").on(table.commitSha),
  ]
);

export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;
