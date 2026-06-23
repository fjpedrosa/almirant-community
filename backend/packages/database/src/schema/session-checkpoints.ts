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

export const sessionCheckpoints = pgTable(
  "session_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planningSessionId: uuid("planning_session_id")
      .notNull()
      .references(() => planningSessions.id, { onDelete: "cascade" }),
    projectorVersion: integer("projector_version").notNull(),
    lastCanonicalSeq: integer("last_canonical_seq").notNull().default(0),
    timeline: jsonb("timeline").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("session_checkpoints_session_unique_idx").on(table.planningSessionId),
    index("session_checkpoints_updated_at_idx").on(table.updatedAt),
  ],
);

export type SessionCheckpointDb = typeof sessionCheckpoints.$inferSelect;
export type NewSessionCheckpoint = typeof sessionCheckpoints.$inferInsert;
