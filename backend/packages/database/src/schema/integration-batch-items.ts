import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  varchar,
  boolean,
} from "drizzle-orm/pg-core";
import {
  integrationBatchItemStatusEnum,
  integrationBatchItemFailureCategoryEnum,
} from "./enums";
import { integrationBatches } from "./integration-batches";
import { workItems } from "./work-items";

export const integrationBatchItems = pgTable(
  "integration_batch_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => integrationBatches.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    branchName: varchar("branch_name", { length: 255 }),
    processingOrder: integer("processing_order").notNull(),
    status: integrationBatchItemStatusEnum("status").notNull().default("pending"),
    failureCategory: integrationBatchItemFailureCategoryEnum("failure_category"),
    failureReason: text("failure_reason"),
    commitShaBefore: varchar("commit_sha_before", { length: 64 }),
    commitShaAfter: varchar("commit_sha_after", { length: 64 }),
    migrationRegenerated: boolean("migration_regenerated").notNull().default(false),
    retryCount: integer("retry_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("integration_batch_items_batch_idx").on(table.batchId),
    index("integration_batch_items_work_item_idx").on(table.workItemId),
    index("integration_batch_items_status_idx").on(table.status),
    index("integration_batch_items_batch_order_idx").on(table.batchId, table.processingOrder),
  ]
);

export type IntegrationBatchItem = typeof integrationBatchItems.$inferSelect;
export type NewIntegrationBatchItem = typeof integrationBatchItems.$inferInsert;
