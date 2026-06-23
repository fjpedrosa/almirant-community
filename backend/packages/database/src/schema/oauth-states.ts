import { pgTable, uuid, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { aiProviderEnum } from "./enums";
import { user } from "./auth";

export const oauthStates = pgTable("oauth_states", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: aiProviderEnum("provider").notNull(),
  state: varchar("state", { length: 255 }).notNull().unique(),
  codeVerifier: text("code_verifier"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type OAuthState = typeof oauthStates.$inferSelect;
export type NewOAuthState = typeof oauthStates.$inferInsert;
