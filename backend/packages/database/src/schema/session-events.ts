import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
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
    kind: varchar("kind", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    provider: varchar("provider", { length: 50 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("session_events_job_seq_idx").on(table.agentJobId, table.sequenceNum),
    index("session_events_session_seq_idx").on(table.planningSessionId, table.sequenceNum),
    index("session_events_kind_idx").on(table.kind),
  ]
);

export type SessionEventDb = typeof sessionEvents.$inferSelect;
export type NewSessionEvent = typeof sessionEvents.$inferInsert;
