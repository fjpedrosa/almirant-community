import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Ledger for idempotent data backfills executed during self-hosted upgrades.
 *
 * Drizzle migrations handle schema shape; this table tracks data repairs that
 * must run after migrations exactly once per checksum/version.
 */
export const dataBackfills = pgTable(
  "data_backfills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 160 }).notNull(),
    description: text("description").notNull(),
    checksum: varchar("checksum", { length: 120 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("running"),
    attemptCount: integer("attempt_count").notNull().default(0),
    processedCount: integer("processed_count"),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("data_backfills_key_unique_idx").on(table.key),
    index("data_backfills_status_idx").on(table.status),
    check(
      "data_backfills_status_check",
      sql`${table.status} IN ('running', 'succeeded', 'failed')`,
    ),
  ],
);

export type DataBackfillDb = typeof dataBackfills.$inferSelect;
export type NewDataBackfill = typeof dataBackfills.$inferInsert;
