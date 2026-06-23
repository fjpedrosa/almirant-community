import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  emailDeliveryStatusEnum,
  waitlistActionTypeEnum,
  waitlistEmailTokenTypeEnum,
  waitlistTierEnum,
  waitlistUserStatusEnum,
} from "./enums";
import { user } from "./auth";

export const waitlistUsers = pgTable(
  "waitlist_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    emailNormalized: varchar("email_normalized", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    status: waitlistUserStatusEnum("status").notNull().default("pending"),
    referralCode: varchar("referral_code", { length: 32 }).notNull(),
    points: integer("points").notNull().default(0),
    tier: waitlistTierEnum("tier").notNull().default("none"),
    locale: varchar("locale", { length: 10 }).notNull().default("en"),

    profileRole: varchar("profile_role", { length: 64 }),
    profileAiStack: jsonb("profile_ai_stack").$type<string[]>(),
    profileAiStackOther: varchar("profile_ai_stack_other", { length: 255 }),
    profileVibeTool: jsonb("profile_vibe_tool").$type<string[]>(),
    profileMonthlySpend: varchar("profile_monthly_spend", { length: 64 }),
    profileFeatures: jsonb("profile_features").$type<string[]>(),
    profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),

    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("waitlist_users_email_normalized_unique").on(table.emailNormalized),
    uniqueIndex("waitlist_users_referral_code_unique").on(table.referralCode),
    index("waitlist_users_status_confirmed_at_idx").on(table.status, table.confirmedAt),
  ]
);

export const waitlistReferrals = pgTable(
  "waitlist_referrals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    referrerUserId: uuid("referrer_user_id")
      .notNull()
      .references(() => waitlistUsers.id, { onDelete: "cascade" }),
    referredUserId: uuid("referred_user_id")
      .notNull()
      .references(() => waitlistUsers.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 32 }).notNull().default("unknown"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("waitlist_referrals_referred_user_id_unique").on(table.referredUserId),
    uniqueIndex("waitlist_referrals_referrer_referred_unique").on(
      table.referrerUserId,
      table.referredUserId
    ),
    index("waitlist_referrals_referrer_confirmed_idx").on(
      table.referrerUserId,
      table.confirmedAt
    ),
  ]
);

export const waitlistActions = pgTable(
  "waitlist_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => waitlistUsers.id, { onDelete: "cascade" }),
    actionType: waitlistActionTypeEnum("action_type").notNull(),
    dedupeKey: varchar("dedupe_key", { length: 191 }).notNull(),
    points: integer("points").notNull().default(0),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("waitlist_actions_dedupe_key_unique").on(table.dedupeKey),
    index("waitlist_actions_user_action_type_idx").on(table.userId, table.actionType),
  ]
);

export const waitlistEmailTokens = pgTable(
  "waitlist_email_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => waitlistUsers.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    tokenType: waitlistEmailTokenTypeEnum("token_type").notNull().default("confirm_email"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("waitlist_email_tokens_token_hash_unique").on(table.tokenHash),
    index("waitlist_email_tokens_user_type_consumed_idx").on(
      table.userId,
      table.tokenType,
      table.consumedAt
    ),
  ]
);

export const waitlistThankYouSends = pgTable(
  "waitlist_thank_you_sends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => waitlistUsers.id, { onDelete: "cascade" }),
    tier: waitlistTierEnum("tier").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
    sentByUserId: text("sent_by_user_id").references(() => user.id, { onDelete: "set null" }),
    resendEmailId: text("resend_email_id"),
    deliveryStatus: emailDeliveryStatusEnum("delivery_status").default("sent"),
    deliveryStatusUpdatedAt: timestamp("delivery_status_updated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("waitlist_thank_you_sends_user_tier_unique").on(table.userId, table.tier),
  ]
);

export type WaitlistUser = typeof waitlistUsers.$inferSelect;
export type NewWaitlistUser = typeof waitlistUsers.$inferInsert;
export type WaitlistReferral = typeof waitlistReferrals.$inferSelect;
export type NewWaitlistReferral = typeof waitlistReferrals.$inferInsert;
export type WaitlistAction = typeof waitlistActions.$inferSelect;
export type NewWaitlistAction = typeof waitlistActions.$inferInsert;
export type WaitlistEmailToken = typeof waitlistEmailTokens.$inferSelect;
export type NewWaitlistEmailToken = typeof waitlistEmailTokens.$inferInsert;
export type WaitlistThankYouSend = typeof waitlistThankYouSends.$inferSelect;
export type NewWaitlistThankYouSend = typeof waitlistThankYouSends.$inferInsert;
