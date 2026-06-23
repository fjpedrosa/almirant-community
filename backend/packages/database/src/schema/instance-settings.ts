import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const INSTANCE_SETTINGS_SINGLETON_KEY = "default";

export type OnboardingStepKey = "admin" | "tailscale" | "github";

export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    singleton: text("singleton")
      .notNull()
      .default(INSTANCE_SETTINGS_SINGLETON_KEY),
    publicUrl: text("public_url"),
    tailscaleUrl: text("tailscale_url"),
    tailscaleHostname: text("tailscale_hostname"),
    githubAppSlug: text("github_app_slug"),
    githubAppId: text("github_app_id"),
    internalFeedbackProjectId: uuid("internal_feedback_project_id"),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    onboardingSkippedSteps: jsonb("onboarding_skipped_steps")
      .$type<OnboardingStepKey[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("instance_settings_singleton_unique_idx").on(table.singleton),
  ],
);

export type InstanceSettings = typeof instanceSettings.$inferSelect;
export type NewInstanceSettings = typeof instanceSettings.$inferInsert;
