import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sprints } from "./sprints";
import { documents } from "./documents";

// Sprint-Document junction table (currently used for sprint visual reports)
export const sprintDocuments = pgTable(
  "sprint_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sprint_documents_sprint_kind_unique_idx").on(table.sprintId, table.kind),
    index("sprint_documents_document_id_idx").on(table.documentId),
  ]
);

export type SprintDocumentDb = typeof sprintDocuments.$inferSelect;
export type NewSprintDocument = typeof sprintDocuments.$inferInsert;

