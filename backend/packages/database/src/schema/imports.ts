import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { importStatusEnum } from "./enums";
import { workspace } from "./workspace";

// Import jobs
export const importJobs = pgTable("import_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  status: importStatusEnum("status").notNull().default("pending"),
  totalRows: integer("total_rows").default(0),
  processedRows: integer("processed_rows").default(0),
  successCount: integer("success_count").default(0),
  errorCount: integer("error_count").default(0),
  errors: jsonb("errors").default([]).$type<Array<{ row: number; error: string }>>(),
  columnMapping: jsonb("column_mapping").default({}).$type<Record<string, string>>(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("import_jobs_workspace_id_idx").on(table.workspaceId),
]);

// Type exports
export type ImportJob = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;
