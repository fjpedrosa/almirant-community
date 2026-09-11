import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agentJobs } from "./agent-jobs";
import { providerConnections } from "./provider-connections";

// Non-secret ownership metadata; credentials remain on provider_connections.
export const piOpenaiConnectionLeases = pgTable(
  "pi_openai_connection_leases",
  {
    connectionId: uuid("connection_id")
      .primaryKey()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    workerId: text("worker_id").notNull(),
    claimAttemptId: text("claim_attempt_id").notNull(),
    credentialVersion: timestamp("credential_version", { withTimezone: true, precision: 3 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("pi_openai_connection_leases_job_unique_idx").on(table.jobId),
    index("pi_openai_connection_leases_expires_at_idx").on(table.expiresAt),
    check(
      "pi_openai_connection_leases_worker_id_check",
      sql`${table.workerId} <> '' AND ${table.workerId} = btrim(${table.workerId})`,
    ),
    check(
      "pi_openai_connection_leases_claim_attempt_id_check",
      sql`${table.claimAttemptId} <> '' AND ${table.claimAttemptId} = btrim(${table.claimAttemptId})`,
    ),
  ],
);

export type PiOpenaiConnectionLease = typeof piOpenaiConnectionLeases.$inferSelect;
export type NewPiOpenaiConnectionLease = typeof piOpenaiConnectionLeases.$inferInsert;
