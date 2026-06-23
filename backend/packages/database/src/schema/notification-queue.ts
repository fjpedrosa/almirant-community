import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { notificationTypeEnum } from "./enums";

export const notificationQueue = pgTable(
  "notification_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").notNull(),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    debounceKey: varchar("debounce_key", { length: 255 }).notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notification_queue_sweeper_idx").on(table.sentAt, table.scheduledAt),
    index("notification_queue_debounce_key_idx").on(table.debounceKey),
    index("notification_queue_recipient_idx").on(table.recipientUserId),
  ]
);

export type NotificationQueueDb = typeof notificationQueue.$inferSelect;
export type NewNotificationQueue = typeof notificationQueue.$inferInsert;
