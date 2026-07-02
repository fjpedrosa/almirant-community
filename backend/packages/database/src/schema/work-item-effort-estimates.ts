import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  varchar,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  effortEstimateConfidenceEnum,
  effortEstimateSourceEnum,
} from "./enums";
import { workItems } from "./work-items";

/**
 * 1:1 effort estimate per work item (A-F-445).
 *
 * Stores the most recent effort estimation produced for a work item.
 * The `content_hash` matches the hash computed by the estimator hook
 * (SHA256 of title + description + type + parentId + sorted childIds)
 * and lets consumers detect whether an estimate is stale vs. current content.
 */
export const workItemEffortEstimates = pgTable(
  "work_item_effort_estimates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    estimatedSubagents: integer("estimated_subagents").notNull(),
    estimatedMemoryMb: integer("estimated_memory_mb").notNull(),
    confidence: effortEstimateConfidenceEnum("confidence").notNull(),
    reasoning: text("reasoning"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    source: effortEstimateSourceEnum("source").notNull().default("llm"),
    stale: boolean("stale").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("work_item_effort_estimates_work_item_id_unique_idx").on(
      table.workItemId
    ),
    index("work_item_effort_estimates_stale_idx")
      .on(table.workItemId)
      .where(sql`stale = true`),
    check(
      "work_item_effort_estimates_subagents_min",
      sql`${table.estimatedSubagents} >= 1`
    ),
    check(
      "work_item_effort_estimates_memory_range",
      sql`${table.estimatedMemoryMb} >= 256 AND ${table.estimatedMemoryMb} <= 65536`
    ),
  ]
);

export type WorkItemEffortEstimate = typeof workItemEffortEstimates.$inferSelect;
export type NewWorkItemEffortEstimate = typeof workItemEffortEstimates.$inferInsert;
