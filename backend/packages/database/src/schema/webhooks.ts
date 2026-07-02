import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { webhookTriggerEnum, webhookStatusEnum } from "./enums";
import { workspace } from "./workspace";

// Webhooks configuration
export const webhooks = pgTable("webhooks", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  url: text("url").notNull(),
  trigger: webhookTriggerEnum("trigger").notNull(),
  isActive: boolean("is_active").default(true),
  headers: jsonb("headers").default({}).$type<Record<string, string>>(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("webhooks_workspace_id_idx").on(table.workspaceId),
]);

// Webhook execution logs
export const webhookLogs = pgTable("webhook_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  webhookId: uuid("webhook_id")
    .notNull()
    .references(() => webhooks.id, { onDelete: "cascade" }),
  status: webhookStatusEnum("status").notNull().default("pending"),
  requestPayload: jsonb("request_payload").$type<Record<string, unknown>>(),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0),
  executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow().notNull(),
});

// Type exports
export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;
export type WebhookLog = typeof webhookLogs.$inferSelect;
