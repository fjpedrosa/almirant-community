import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { workItems } from "./work-items";

// Document-WorkItem junction table (many-to-many)
export const documentWorkItems = pgTable(
  "document_work_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_work_items_unique_idx").on(
      table.documentId,
      table.workItemId
    ),
    index("document_work_items_document_idx").on(table.documentId),
    index("document_work_items_work_item_idx").on(table.workItemId),
  ]
);

// Type exports
export type DocumentWorkItem = typeof documentWorkItems.$inferSelect;
export type NewDocumentWorkItem = typeof documentWorkItems.$inferInsert;
