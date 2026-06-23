import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Per-user view preferences for each page/context
export const userViewPreferences = pgTable(
  "user_view_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pageKey: varchar("page_key", { length: 100 }).notNull(),
    config: jsonb("config").notNull().$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_view_preferences_user_page_idx").on(table.userId, table.pageKey),
  ]
);

// Type exports
export type UserViewPreference = typeof userViewPreferences.$inferSelect;
export type NewUserViewPreference = typeof userViewPreferences.$inferInsert;
