import {
  pgTable,
  uuid,
  text,
  real,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import {
  feedbackTopicProposalTypeEnum,
  feedbackTopicProposalStatusEnum,
} from "./enums";
import { feedbackTopics } from "./feedback-topics";

// ── Payload Types ──────────────────────────────────────────

export interface MergePayload {
  targetTopicId: string;
}

export interface SplitPayload {
  subtopics: { title: string; clusterIds: string[] }[];
}

export interface RenamePayload {
  newTitle: string;
  newSlug?: string;
}

export type FeedbackTopicProposalPayload =
  | MergePayload
  | SplitPayload
  | RenamePayload;

// ── Table ──────────────────────────────────────────────────
//
// Feedback is mono-project by definition (the Almirant project), so
// `project_id` was dropped.

export const feedbackTopicProposals = pgTable(
  "feedback_topic_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: feedbackTopicProposalTypeEnum("type").notNull(),
    status: feedbackTopicProposalStatusEnum("status")
      .notNull()
      .default("pending"),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => feedbackTopics.id, { onDelete: "cascade" }),
    payload: jsonb("payload")
      .notNull()
      .$type<FeedbackTopicProposalPayload>(),
    reason: text("reason"),
    confidence: real("confidence"),
    createdBy: text("created_by").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    reviewerNotes: text("reviewer_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ftp_status_idx").on(table.status),
    index("ftp_topic_id_idx").on(table.topicId),
    index("ftp_type_status_idx").on(table.type, table.status),
  ]
);

// ── Type Exports ───────────────────────────────────────────

export type FeedbackTopicProposal = typeof feedbackTopicProposals.$inferSelect;
export type NewFeedbackTopicProposal = typeof feedbackTopicProposals.$inferInsert;
