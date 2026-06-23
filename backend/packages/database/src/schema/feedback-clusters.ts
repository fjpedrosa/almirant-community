import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  customType,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { feedbackClusterStatusEnum, workItemTypeEnum, priorityEnum } from "./enums";
import { feedbackItems } from "./feedback-items";
import { feedbackTopics } from "./feedback-topics";
import { workItems } from "./work-items";
import { bugFixAttempts } from "./bug-fix-attempts";

// Custom type for pgvector vector(1536) — for embedding-based clustering
const vector1536 = customType<{ data: number[] }>({
  dataType() {
    return "vector(1536)";
  },
});

// Feedback clusters (groups of related feedback items)
//
// Feedback is mono-project by definition (the Almirant project), so
// `project_id` was dropped. Callers that need the project use
// `getAlmirantProjectId()` from `@almirant/config`.
export const feedbackClusters = pgTable(
  "feedback_clusters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 500 }).notNull(),
    summary: text("summary"),
    itemCount: integer("item_count").default(0).notNull(),
    status: feedbackClusterStatusEnum("status").notNull().default("open"),
    topicId: uuid("topic_id").references(() => feedbackTopics.id, {
      onDelete: "set null",
    }),
    suggestedType: workItemTypeEnum("suggested_type"),
    suggestedPriority: priorityEnum("suggested_priority"),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    embedding: vector1536("embedding"),
    // Lifecycle tracking — set when the cluster transitions to `resolved`.
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByAttemptId: uuid("resolved_by_attempt_id").references(
      (): AnyPgColumn => bugFixAttempts.id,
      { onDelete: "set null" }
    ),
    // Regression tracking — timestamp of most recent resolved → regression flip
    // and total count of regressions observed for toxic-cluster detection.
    lastRegressionAt: timestamp("last_regression_at", { withTimezone: true }),
    regressionCount: integer("regression_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("feedback_clusters_status_idx").on(table.status),
    index("feedback_clusters_status_created_idx").on(table.status, table.createdAt),
  ]
);

// Feedback promotions (link feedback items to work items)
export const feedbackPromotions = pgTable(
  "feedback_promotions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedbackItemId: uuid("feedback_item_id")
      .notNull()
      .references(() => feedbackItems.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    promotedBy: varchar("promoted_by", { length: 255 }),
    notes: text("notes"),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("feedback_promotions_feedback_item_id_idx").on(table.feedbackItemId),
    index("feedback_promotions_work_item_id_idx").on(table.workItemId),
  ]
);

// Type exports
export type FeedbackCluster = typeof feedbackClusters.$inferSelect;
export type NewFeedbackCluster = typeof feedbackClusters.$inferInsert;
export type FeedbackPromotion = typeof feedbackPromotions.$inferSelect;
export type NewFeedbackPromotion = typeof feedbackPromotions.$inferInsert;
