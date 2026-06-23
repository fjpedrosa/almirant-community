import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  bigint,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { aiProviderEnum, quotaTypeEnum, quotaAlertTypeEnum } from "./enums";
import { organization } from "./organization";

// Provider quotas - configurable limits per AI provider
export const providerQuotas = pgTable(
  "provider_quotas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: aiProviderEnum("provider").notNull(),
    quotaType: quotaTypeEnum("quota_type").notNull(),
    maxTokens: bigint("max_tokens", { mode: "number" }),
    maxCostUsd: numeric("max_cost_usd", { precision: 10, scale: 6 }),
    maxRequests: integer("max_requests"),
    isActive: boolean("is_active").default(true).notNull(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("provider_quotas_provider_idx").on(table.provider),
    index("provider_quotas_organization_id_idx").on(table.organizationId),
  ]
);

// Quota usage periods - aggregated usage per provider per time period
export const quotaUsagePeriods = pgTable(
  "quota_usage_periods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: aiProviderEnum("provider").notNull(),
    periodType: quotaTypeEnum("period_type").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    totalTokens: bigint("total_tokens", { mode: "number" }).notNull().default(0),
    totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    totalRequests: integer("total_requests").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("quota_usage_periods_provider_period_idx").on(
      table.provider,
      table.periodType,
      table.periodStart
    ),
  ]
);

// Quota alerts - notifications when usage approaches or exceeds limits
export const quotaAlerts = pgTable(
  "quota_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerQuotaId: uuid("provider_quota_id")
      .notNull()
      .references(() => providerQuotas.id, { onDelete: "cascade" }),
    alertType: quotaAlertTypeEnum("alert_type").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    message: text("message"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("quota_alerts_provider_quota_idx").on(table.providerQuotaId),
  ]
);

// Type exports
export type ProviderQuotaDb = typeof providerQuotas.$inferSelect;
export type NewProviderQuota = typeof providerQuotas.$inferInsert;
export type QuotaUsagePeriodDb = typeof quotaUsagePeriods.$inferSelect;
export type NewQuotaUsagePeriod = typeof quotaUsagePeriods.$inferInsert;
export type QuotaAlertDb = typeof quotaAlerts.$inferSelect;
export type NewQuotaAlert = typeof quotaAlerts.$inferInsert;
