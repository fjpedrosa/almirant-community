import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { agentProviderEnum, codingAgentEnum } from "./enums";
import { agentJobs } from "./agent-jobs";
import { planningSessions } from "./planning-sessions";

export const agentNativeEvents = pgTable(
  "agent_native_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentJobId: uuid("agent_job_id")
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    planningSessionId: uuid("planning_session_id").references(() => planningSessions.id, {
      onDelete: "cascade",
    }),
    sequenceNum: integer("sequence_num").notNull(),
    nativeEventType: varchar("native_event_type", { length: 120 }).notNull(),
    sourceFormat: varchar("source_format", { length: 50 }).notNull().default("sse"),
    provider: agentProviderEnum("provider"),
    codingAgent: codingAgentEnum("coding_agent"),
    runtimeSessionId: varchar("runtime_session_id", { length: 255 }),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    emittedAt: timestamp("emitted_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_native_events_job_seq_unique_idx").on(table.agentJobId, table.sequenceNum),
    index("agent_native_events_session_seq_idx").on(table.planningSessionId, table.sequenceNum),
    index("agent_native_events_type_idx").on(table.nativeEventType),
    index("agent_native_events_received_at_idx").on(table.receivedAt),
  ],
);

export type AgentNativeEventDb = typeof agentNativeEvents.$inferSelect;
export type NewAgentNativeEvent = typeof agentNativeEvents.$inferInsert;
