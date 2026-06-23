import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { planningSessions } from "./planning-sessions";

export const sessionSnapshots = pgTable(
  "session_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planningSessionId: uuid("planning_session_id")
      .notNull()
      .references(() => planningSessions.id, { onDelete: "cascade" }),
    projectorVersion: integer("projector_version").notNull(),
    lastCanonicalSeq: integer("last_canonical_seq").notNull().default(0),
    timeline: jsonb("timeline").notNull().$type<Record<string, unknown>>(),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("session_snapshots_session_unique_idx").on(table.planningSessionId),
    index("session_snapshots_updated_at_idx").on(table.updatedAt),
  ],
);

export type SessionSnapshotDb = typeof sessionSnapshots.$inferSelect;
export type NewSessionSnapshot = typeof sessionSnapshots.$inferInsert;
