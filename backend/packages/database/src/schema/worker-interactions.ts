import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workerQuestionTypeEnum, workerInteractionStatusEnum } from "./enums";
import { agentJobs } from "./agent-jobs";
import { workItems } from "./work-items";
import { user } from "./auth";

export const workerInteractions = pgTable(
  "worker_interactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentJobId: uuid("agent_job_id")
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .references(() => workItems.id, { onDelete: "set null" }),
    questionType: workerQuestionTypeEnum("question_type").notNull(),
    questionText: text("question_text").notNull(),
    questionContext: jsonb("question_context").$type<Record<string, unknown>>(),
    options: jsonb("options").$type<string[]>(),
    answerText: text("answer_text"),
    answerMetadata: jsonb("answer_metadata").$type<Record<string, unknown>>(),
    answeredBy: text("answered_by")
      .references(() => user.id, { onDelete: "set null" }),
    status: workerInteractionStatusEnum("status").notNull().default("pending"),
    askedAt: timestamp("asked_at", { withTimezone: true }).defaultNow().notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    timeoutAction: text("timeout_action").notNull().default("fail"),
    defaultAnswer: text("default_answer"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("worker_interactions_job_status_idx").on(table.agentJobId, table.status),
    index("worker_interactions_work_item_idx").on(table.workItemId),
    index("worker_interactions_expires_pending_idx")
      .on(table.expiresAt)
      .where(sql`status = 'pending'`),
  ]
);

// Type exports
export type WorkerInteraction = typeof workerInteractions.$inferSelect;
export type NewWorkerInteraction = typeof workerInteractions.$inferInsert;
