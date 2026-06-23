import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Browser push subscription (one per browser/device)
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    endpoint: text("endpoint").notNull(),
    p256dhKey: text("p256dh_key").notNull(),
    authKey: text("auth_key").notNull(),

    userAgent: text("user_agent"),
    deviceLabel: text("device_label"),

    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    endpointUnique: uniqueIndex("push_subscriptions_endpoint_unique").on(t.endpoint),
    userIdActiveIdx: index("push_subscriptions_user_id_active_idx").on(t.userId, t.isActive),
  })
);

// Per-user push notification settings (toggles per event type)
export const pushNotificationSettings = pgTable(
  "push_notification_settings",
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
    userIdUnique: uniqueIndex("push_notification_settings_user_id_unique").on(t.userId),
  })
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
export type PushNotificationSettings = typeof pushNotificationSettings.$inferSelect;
export type NewPushNotificationSettings = typeof pushNotificationSettings.$inferInsert;
