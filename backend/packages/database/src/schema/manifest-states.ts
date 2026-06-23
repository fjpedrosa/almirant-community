import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Persisted state for the GitHub App manifest flow (Coolify-style).
 *
 * Replaces the previous in-memory `Map<string, number>` so pending flows
 * survive backend restarts. A single backend pod is assumed for self-host;
 * even so, persisting here also lets us audit who started what flow and
 * when.
 *
 * Rows expire 10 minutes after creation; a sweeper deletes stale rows
 * lazily on each manifest request and during the manifest-callback handler.
 */
export const manifestStates = pgTable(
  "manifest_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    state: varchar("state", { length: 255 }).notNull().unique(),
    appName: text("app_name").notNull(),
    returnTo: text("return_to"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("manifest_states_expires_at_idx").on(table.expiresAt),
  ],
);

export type ManifestState = typeof manifestStates.$inferSelect;
export type NewManifestState = typeof manifestStates.$inferInsert;
