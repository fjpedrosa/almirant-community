import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { workItems } from "./work-items";

// Work item attachments
export const workItemAttachments = pgTable(
  "work_item_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 500 }).notNull(),
    fileUrl: text("file_url").notNull(),
    fileSize: integer("file_size"),
    mimeType: varchar("mime_type", { length: 255 }),
    uploadedBy: varchar("uploaded_by", { length: 255 }),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("work_item_attachments_work_item_id_idx").on(table.workItemId),
  ]
);

// Type exports
export type WorkItemAttachmentDb = typeof workItemAttachments.$inferSelect;
export type NewWorkItemAttachment = typeof workItemAttachments.$inferInsert;
