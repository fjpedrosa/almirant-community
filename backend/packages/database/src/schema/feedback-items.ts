import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { feedbackStatusEnum, feedbackCategoryEnum, workItemTypeEnum, bugDomainEnum } from "./enums";
import { feedbackSources } from "./feedback-sources";
import { feedbackClusters } from "./feedback-clusters";
import { feedbackTopics } from "./feedback-topics";
import { workItems } from "./work-items";

// Custom type for pgvector vector(1536) — for embedding-based clustering
const vector1536 = customType<{ data: number[] }>({
  dataType() {
    return "vector(1536)";
  },
});

// Feedback items (individual pieces of feedback)
//
// All feedback in Almirant belongs, by definition, to the Almirant project.
// There is no multi-project feedback: the `project_id` column was dropped
// because it added a useless FK. Callers that need a project reference use
// `getAlmirantProjectId()` from `@almirant/config`.
export const feedbackItems = pgTable(
  "feedback_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .references(() => feedbackSources.id, { onDelete: "set null" }),
    clusterId: uuid("cluster_id")
      .references(() => feedbackClusters.id, { onDelete: "set null" }),
    topicId: uuid("topic_id").references(() => feedbackTopics.id, {
      onDelete: "set null",
    }),
    status: feedbackStatusEnum("status").notNull().default("new"),
    category: feedbackCategoryEnum("category").notNull().default("other"),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content"),
    authorName: varchar("author_name", { length: 255 }),
    authorEmail: varchar("author_email", { length: 255 }),
    authorMeta: jsonb("author_meta").default({}).$type<Record<string, unknown>>(),
    sentiment: varchar("sentiment", { length: 20 }),
    // AI suggestion fields (populated by triage pipeline)
    aiSuggestedType: workItemTypeEnum("ai_suggested_type"),
    aiSuggestedTitle: varchar("ai_suggested_title", { length: 500 }),
    aiSuggestedSummary: text("ai_suggested_summary"),
    aiCategory: feedbackCategoryEnum("ai_category"),
    aiConfidence: varchar("ai_confidence", { length: 10 }),
    aiReasoning: text("ai_reasoning"),
    aiDomain: bugDomainEnum("ai_domain"),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    promotedWorkItemId: uuid("promoted_work_item_id")
      .references(() => workItems.id, { onDelete: "set null" }),
    embedding: vector1536("embedding"),
    requiresReview: boolean("requires_review").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("feedback_items_status_created_idx").on(table.status, table.createdAt),
    index("feedback_items_source_id_idx").on(table.sourceId),
    index("feedback_items_cluster_id_idx").on(table.clusterId),
    index("feedback_items_topic_id_idx").on(table.topicId),
    index("feedback_items_promoted_work_item_id_idx").on(table.promotedWorkItemId),
  ]
);

// Type exports
export type FeedbackItem = typeof feedbackItems.$inferSelect;
export type NewFeedbackItem = typeof feedbackItems.$inferInsert;
