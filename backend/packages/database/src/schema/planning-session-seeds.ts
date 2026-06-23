import {
  pgTable,
  uuid,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { planningSessions } from "./planning-sessions";
import { seeds } from "./seeds";

export const planningSessionSeeds = pgTable(
  "planning_session_seeds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => planningSessions.id, { onDelete: "cascade" }),
    seedId: uuid("seed_id")
      .notNull()
      .references(() => seeds.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("planning_session_seeds_unique_idx").on(table.sessionId, table.seedId),
  ]
);

export type PlanningSessionSeed = typeof planningSessionSeeds.$inferSelect;
export type NewPlanningSessionSeed = typeof planningSessionSeeds.$inferInsert;
