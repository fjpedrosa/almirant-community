import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { notificationTypeEnum } from "./enums";

// In-app notifications shown in the UI
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    type: notificationTypeEnum("type").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    link: text("link"),
    sourceEntityType: varchar("source_entity_type", { length: 50 }),
    sourceEntityId: uuid("source_entity_id"),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("notifications_recipient_idx").on(table.recipientUserId),
    index("notifications_recipient_unread_idx").on(
      table.recipientUserId,
      table.isRead
    ),
    index("notifications_org_idx").on(table.workspaceId),
    index("notifications_created_at_idx").on(table.createdAt),
  ]
);

export type NotificationDb = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// Per-user notification preferences (in-app vs email per type)
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    notificationType: notificationTypeEnum("notification_type").notNull(),
    inAppEnabled: boolean("in_app_enabled").notNull().default(true),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    pushEnabled: boolean("push_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("notification_preferences_user_org_type_unique").on(
      t.userId,
      t.workspaceId,
      t.notificationType
    ),
  ]
);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
