import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { workItems } from "./work-items";
import { agentJobs } from "./agent-jobs";
import type { ProvenanceMetadata } from "./provenance";

/** Typed metadata for AI sessions, extending the common provenance model */
export interface AiSessionMetadata extends ProvenanceMetadata {
  [key: string]: unknown;
}

// AI sessions - tracks token usage and cost per AI interaction with a work item
export const aiSessions = pgTable(
  "ai_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    agentJobId: uuid("agent_job_id").references(() => agentJobs.id, { onDelete: "set null" }),
    model: varchar("model", { length: 100 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull().default("anthropic"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    estimatedCost: numeric("estimated_cost", { precision: 10, scale: 6 }).notNull().default("0"),
    durationMs: integer("duration_ms"),
    sessionType: varchar("session_type", { length: 50 }).notNull().default("implement"),
    metadata: jsonb("metadata").default({}).$type<AiSessionMetadata>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_sessions_work_item_idx").on(table.workItemId),
    index("ai_sessions_agent_job_idx").on(table.agentJobId),
    index("ai_sessions_created_at_idx").on(table.createdAt),
  ]
);

// Type exports
export type AiSessionDb = typeof aiSessions.$inferSelect;
export type NewAiSession = typeof aiSessions.$inferInsert;
