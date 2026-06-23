import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { serviceAccountTypeEnum } from "./enums";

// Service accounts for non-human actors (runners, integrations)
export const serviceAccounts = pgTable("service_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: serviceAccountTypeEnum("type").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("service_accounts_organization_id_idx").on(table.organizationId),
  unique("service_accounts_org_name_unique").on(table.organizationId, table.name),
]);

// Type exports
export type ServiceAccount = typeof serviceAccounts.$inferSelect;
export type NewServiceAccount = typeof serviceAccounts.$inferInsert;
