import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { aiKeyPolicyEnum, orchestrationStrategyEnum } from "./enums";

export const organizationSettings = pgTable("organization_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  aiKeyPolicy: aiKeyPolicyEnum("ai_key_policy").default("user_preferred").notNull(),
  orchestrationStrategy: orchestrationStrategyEnum("orchestration_strategy"),
  maxConcurrentJobs: integer("max_concurrent_jobs").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type OrganizationSettings = typeof organizationSettings.$inferSelect;
export type NewOrganizationSettings = typeof organizationSettings.$inferInsert;
