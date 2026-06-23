import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { agentJobs } from "./agent-jobs";
import { organization } from "./organization";
import { workItems } from "./work-items";

export type AgentJobLogLevel = "debug" | "info" | "warn" | "error";

export const agentJobLogs = pgTable(
  "agent_job_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    seq: integer("seq").notNull(),
    level: varchar("level", { length: 16 }).$type<AgentJobLogLevel>().notNull().default("info"),
    phase: varchar("phase", { length: 64 }).notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    contentType: varchar("content_type", { length: 32 }).notNull().default("text"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_job_logs_job_seq_unique_idx").on(table.jobId, table.seq),
    index("agent_job_logs_job_timestamp_idx").on(table.jobId, table.timestamp),
    index("agent_job_logs_timestamp_idx").on(table.timestamp),
    index("agent_job_logs_work_item_idx").on(table.workItemId),
    index("agent_job_logs_job_transcript_seq_idx")
      .on(table.jobId, table.seq)
      .where(sql`phase = 'transcript'`),
    index("agent_job_logs_job_content_type_idx")
      .on(table.jobId, table.contentType, table.seq)
      .where(sql`phase = 'transcript'`),
  ]
);

export type AgentJobLogDb = typeof agentJobLogs.$inferSelect;
export type NewAgentJobLog = typeof agentJobLogs.$inferInsert;
