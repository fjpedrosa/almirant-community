import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentJobs } from "./agent-jobs";
import { planningSessions } from "./planning-sessions";

/**
 * Stores ALL canonical events emitted during a coding agent session.
 * One row per event. Enables full session replay on page refresh.
 */
export const sessionEvents = pgTable(
  "session_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentJobId: uuid("agent_job_id")
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    planningSessionId: uuid("planning_session_id")
      .references(() => planningSessions.id, { onDelete: "cascade" }),
    sequenceNum: integer("sequence_num").notNull(),
    sequenceProtocolVersion: varchar("sequence_protocol_version", { length: 32 })
      .$type<"durable.v2">(),
    kind: varchar("kind", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    provider: varchar("provider", { length: 50 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("session_events_job_seq_idx").on(table.agentJobId, table.sequenceNum),
    uniqueIndex("session_events_durable_job_seq_unique_idx").on(
      table.agentJobId,
      table.sequenceNum,
    ).where(sql`${table.sequenceProtocolVersion} = 'durable.v2'`),
    index("session_events_session_seq_idx").on(table.planningSessionId, table.sequenceNum),
    index("session_events_kind_idx").on(table.kind),
  ]
);

/**
 * PostgreSQL must see this predicate as a literal when inferring the partial
 * unique index for ON CONFLICT. A bound parameter cannot imply the index
 * predicate at planning time.
 */
export const DURABLE_SESSION_EVENT_CONFLICT_PREDICATE =
  sql`${sessionEvents.sequenceProtocolVersion} = 'durable.v2'`;

export type SessionEventDb = typeof sessionEvents.$inferSelect;
export type NewSessionEvent = typeof sessionEvents.$inferInsert;
