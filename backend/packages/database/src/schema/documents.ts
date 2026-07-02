import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  index,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { documentCategoryStatusEnum } from "./enums";
import { projects } from "./projects";
import { workspace } from "./workspace";

// Custom type for PostgreSQL tsvector (full-text search)
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// Document categories
export const documentCategories = pgTable(
  "document_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id").references((): AnyPgColumn => documentCategories.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    color: varchar("color", { length: 7 }).notNull().default("#8b5cf6"),
    icon: varchar("icon", { length: 50 }),
    order: integer("order").notNull().default(0),
    status: documentCategoryStatusEnum("status").notNull().default("active"),
    workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("document_categories_parent_idx").on(table.parentId),
    index("document_categories_workspace_id_idx").on(table.workspaceId),
  ]
);

// Documents
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content"),
    categoryId: uuid("category_id").references(() => documentCategories.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    wordCount: integer("word_count").default(0),
    sizeBytes: integer("size_bytes").default(0),
    isPinned: boolean("is_pinned").default(false),
    contentHash: varchar("content_hash", { length: 64 }),
    s3Key: text("s3_key"),
    filePath: text("file_path"),
    searchVector: tsvector("search_vector"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("documents_category_idx").on(table.categoryId),
    index("documents_project_idx").on(table.projectId),
    index("documents_created_at_idx").on(table.createdAt),
    index("documents_is_pinned_idx").on(table.isPinned),
    index("documents_content_hash_idx").on(table.contentHash),
    index("documents_file_path_project_idx").on(table.filePath, table.projectId),
  ]
);

// Type exports
export type DocumentCategory = typeof documentCategories.$inferSelect;
export type NewDocumentCategory = typeof documentCategories.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
