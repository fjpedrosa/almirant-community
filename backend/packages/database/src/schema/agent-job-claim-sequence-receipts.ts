import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { agentJobs } from "./agent-jobs";

export type ClaimSequenceReceiptState =
  | "active"
  | "draining"
  | "ready"
  | "released"
  | "terminal"
  | "crashed";

/**
 * Immutable claim identity plus disjoint per-channel sequence reservations.
 * Progress counters are updated in the same transaction as durable inserts.
 */
export const agentJobClaimSequenceReceipts = pgTable(
  "agent_job_claim_sequence_receipts",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    claimAttemptId: text("claim_attempt_id").notNull(),
    workerId: text("worker_id").notNull(),
    state: varchar("state", { length: 24 })
      .$type<ClaimSequenceReceiptState>()
      .notNull()
      .default("active"),

    jobLogSequenceStart: integer("job_log_sequence_start").notNull(),
    jobLogSequenceEnd: integer("job_log_sequence_end").notNull(),
    jobLogEmittedThrough: integer("job_log_emitted_through"),
    jobLogInsertedCount: integer("job_log_inserted_count").notNull().default(0),

    sessionEventSequenceStart: integer("session_event_sequence_start").notNull(),
    sessionEventSequenceEnd: integer("session_event_sequence_end").notNull(),
    sessionEventEmittedThrough: integer("session_event_emitted_through"),
    sessionEventInsertedCount: integer("session_event_inserted_count").notNull().default(0),

    nativeEventSequenceStart: integer("native_event_sequence_start").notNull(),
    nativeEventSequenceEnd: integer("native_event_sequence_end").notNull(),
    nativeEventEmittedThrough: integer("native_event_emitted_through"),
    nativeEventInsertedCount: integer("native_event_inserted_count").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      name: "agent_job_claim_sequence_receipts_pk",
      columns: [table.jobId, table.claimAttemptId],
    }),
    index("agent_job_claim_sequence_receipts_job_state_idx").on(table.jobId, table.state),
    check(
      "agent_job_claim_sequence_receipts_state_check",
      sql`${table.state} IN ('active', 'draining', 'ready', 'released', 'terminal', 'crashed')`,
    ),
    check(
      "agent_job_claim_sequence_receipts_log_range_check",
      sql`${table.jobLogSequenceStart} >= 1 AND ${table.jobLogSequenceEnd} >= ${table.jobLogSequenceStart}`,
    ),
    check(
      "agent_job_claim_sequence_receipts_session_range_check",
      sql`${table.sessionEventSequenceStart} >= 1 AND ${table.sessionEventSequenceEnd} >= ${table.sessionEventSequenceStart}`,
    ),
    check(
      "agent_job_claim_sequence_receipts_native_range_check",
      sql`${table.nativeEventSequenceStart} >= 1 AND ${table.nativeEventSequenceEnd} >= ${table.nativeEventSequenceStart}`,
    ),
    check(
      "agent_job_claim_sequence_receipts_counts_check",
      sql`${table.jobLogInsertedCount} >= 0 AND ${table.sessionEventInsertedCount} >= 0 AND ${table.nativeEventInsertedCount} >= 0`,
    ),
  ],
);

export type AgentJobClaimSequenceReceipt =
  typeof agentJobClaimSequenceReceipts.$inferSelect;
export type NewAgentJobClaimSequenceReceipt =
  typeof agentJobClaimSequenceReceipts.$inferInsert;
