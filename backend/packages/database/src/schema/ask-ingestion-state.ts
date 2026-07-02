import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { askIngestionStatusEnum } from "./enums";
import { projects } from "./projects";
import { workspace } from "./workspace";

/**
 * Tracks incremental ingestion cursors per (workspace, project, sourceType).
 * Allows the ingestion pipeline to resume from where it left off.
 */
export const askIngestionState = pgTable(
  "ask_ingestion_state",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    sourceType: text("source_type").notNull(),
    lastProcessedAt: timestamp("last_processed_at", { withTimezone: true }),
    lastProcessedId: text("last_processed_id"),
    itemsProcessed: integer("items_processed").default(0),
    status: askIngestionStatusEnum("status").notNull().default("idle"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("ask_ingestion_state_org_project_source_idx").on(
      table.workspaceId,
      table.projectId,
      table.sourceType
    ),
  ]
);

// Type exports
export type AskIngestionState = typeof askIngestionState.$inferSelect;
export type NewAskIngestionState = typeof askIngestionState.$inferInsert;
