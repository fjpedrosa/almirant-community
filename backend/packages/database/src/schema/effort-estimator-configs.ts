import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  varchar,
  numeric,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { aiProviderEnum } from "./enums";
import { user } from "./auth";

/**
 * Admin-singleton configuration for the effort estimator LLM (A-F-445).
 *
 * Only one row should be active at any time. We use a sentinel `singleton`
 * boolean column (default true) combined with a partial unique index
 * `(singleton) WHERE is_active = true` to guarantee the invariant in a
 * Drizzle-portable way — Drizzle can fail to emit expressions like
 * `sql(((true)))` inside `.on()`, so the sentinel column is the safe pattern.
 */
export const effortEstimatorConfigs = pgTable(
  "effort_estimator_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: aiProviderEnum("provider").notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    temperature: numeric("temperature", { precision: 3, scale: 2 })
      .notNull()
      .default("0"),
    maxTokens: integer("max_tokens").notNull().default(1024),
    systemPrompt: text("system_prompt").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    // Sentinel column — always true — so the partial unique index below can
    // target a concrete column instead of a SQL literal.
    singleton: boolean("singleton").notNull().default(true),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("effort_estimator_configs_singleton_active_unique_idx")
      .on(table.singleton)
      .where(sql`is_active = true`),
  ]
);

export type EffortEstimatorConfig = typeof effortEstimatorConfigs.$inferSelect;
export type NewEffortEstimatorConfig =
  typeof effortEstimatorConfigs.$inferInsert;
