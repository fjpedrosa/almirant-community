import { pgTable, uuid, text, timestamp, uniqueIndex, jsonb, index } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const onboardingStatus = pgTable(
  "onboarding_status",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    githubCompletedAt: timestamp("github_completed_at", { withTimezone: true }),
    vercelCompletedAt: timestamp("vercel_completed_at", { withTimezone: true }),
    aiProviderCompletedAt: timestamp("ai_provider_completed_at", {
      withTimezone: true,
    }),
    firstProjectCompletedAt: timestamp("first_project_completed_at", {
      withTimezone: true,
    }),

    bannerDismissedAt: timestamp("banner_dismissed_at", { withTimezone: true }),

    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    skippedSteps: jsonb("skipped_steps").$type<Record<string, string>>(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdUnique: uniqueIndex("onboarding_status_user_id_unique").on(t.userId),
  })
);

export type OnboardingStatus = typeof onboardingStatus.$inferSelect;
export type NewOnboardingStatus = typeof onboardingStatus.$inferInsert;

export const onboardingEvents = pgTable(
  "onboarding_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    action: text("action").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userCreatedAtIdx: index("onboarding_events_user_created_at_idx").on(t.userId, t.createdAt),
  })
);

export type OnboardingEvent = typeof onboardingEvents.$inferSelect;
export type NewOnboardingEvent = typeof onboardingEvents.$inferInsert;

