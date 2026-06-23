import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Per-user notification preferences for Email (via Resend)
export const emailNotificationSettings = pgTable(
  "email_notification_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    enabled: boolean("enabled").notNull().default(true),

    notifyWorkItemMoved: boolean("notify_work_item_moved").notNull().default(true),
    notifyWorkItemAssigned: boolean("notify_work_item_assigned").notNull().default(true),
    notifyWorkItemDone: boolean("notify_work_item_done").notNull().default(true),
    notifyReviewCompleted: boolean("notify_review_completed").notNull().default(true),
    notifySprintClosed: boolean("notify_sprint_closed").notNull().default(true),
    notifyUserActions: boolean("notify_user_actions").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdUnique: uniqueIndex("email_notification_settings_user_id_unique").on(t.userId),
  })
);

export type EmailNotificationSettings = typeof emailNotificationSettings.$inferSelect;
export type NewEmailNotificationSettings = typeof emailNotificationSettings.$inferInsert;
