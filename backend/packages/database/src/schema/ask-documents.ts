import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { askSourceTypeEnum } from "./enums";
import { projects } from "./projects";
import { workspace } from "./workspace";
import { workItems } from "./work-items";

// Custom type for PostgreSQL tsvector (full-text search)
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Unified evidence index for the Ask feature.
 * Each row represents a single piece of evidence (work item, document, event, commit)
 * that can be used to answer historical questions.
 */
export const askDocuments = pgTable(
  "ask_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    sourceType: askSourceTypeEnum("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content"),
    excerpt: text("excerpt"),
    searchVector: tsvector("search_vector"),
    featureId: uuid("feature_id").references(() => workItems.id, {
      onDelete: "set null",
    }),
    sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("ask_documents_source_type_source_id_idx").on(
      table.sourceType,
      table.sourceId
    ),
    index("ask_documents_project_idx").on(table.projectId),
    index("ask_documents_feature_idx").on(table.featureId),
    index("ask_documents_source_type_idx").on(table.sourceType),
    index("ask_documents_source_timestamp_idx").on(table.sourceTimestamp),
    index("ask_documents_workspace_idx").on(table.workspaceId),
  ]
);

// Type exports
export type AskDocument = typeof askDocuments.$inferSelect;
export type NewAskDocument = typeof askDocuments.$inferInsert;
