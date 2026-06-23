import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { feedbackSourceTypeEnum } from "./enums";

// Feedback sources (widget, API, telegram, etc.)
export const feedbackSources = pgTable(
  "feedback_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    type: feedbackSourceTypeEnum("type").notNull().default("widget"),
    publicKey: varchar("public_key", { length: 64 }).unique().notNull(),
    allowedDomains: jsonb("allowed_domains").default([]).$type<string[]>(),
    isActive: boolean("is_active").default(true).notNull(),
    config: jsonb("config").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// Type exports
export type FeedbackSource = typeof feedbackSources.$inferSelect;
export type NewFeedbackSource = typeof feedbackSources.$inferInsert;
