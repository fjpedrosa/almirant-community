import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { feedbackTopicStatusEnum } from "./enums";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// Feedback is mono-project by definition (the Almirant project), so
// `project_id` was dropped. Slugs are now globally unique within the table.
export const feedbackTopics = pgTable(
  "feedback_topics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentTopicId: uuid("parent_topic_id").references(
      (): AnyPgColumn => feedbackTopics.id,
      { onDelete: "set null" }
    ),
    title: text("title").notNull(),
    slug: varchar("slug", { length: 1000 }).notNull(),
    description: text("description"),
    embedding: text("embedding"), // stored as JSON array string; vector(1536) requires pgvector extension
    itemCount: integer("item_count").default(0).notNull(),
    clusterCount: integer("cluster_count").default(0).notNull(),
    status: feedbackTopicStatusEnum("status").notNull().default("active"),
    mergedIntoTopicId: uuid("merged_into_topic_id").references(
      (): AnyPgColumn => feedbackTopics.id,
      { onDelete: "set null" }
    ),
    createdBy: varchar("created_by", { length: 50 }).notNull().default("ai"),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("feedback_topics_parent_status_idx").on(
      table.parentTopicId,
      table.status
    ),
    uniqueIndex("feedback_topics_slug_idx").on(table.slug),
    index("feedback_topics_status_idx").on(table.status),
  ]
);

export type FeedbackTopic = typeof feedbackTopics.$inferSelect;
export type NewFeedbackTopic = typeof feedbackTopics.$inferInsert;
