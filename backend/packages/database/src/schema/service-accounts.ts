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
import { workspace } from "./workspace";
import { serviceAccountTypeEnum } from "./enums";

// Service accounts for non-human actors (runners, integrations)
export const serviceAccounts = pgTable("service_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: serviceAccountTypeEnum("type").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("service_accounts_workspace_id_idx").on(table.workspaceId),
  unique("service_accounts_org_name_unique").on(table.workspaceId, table.name),
]);

// Type exports
export type ServiceAccount = typeof serviceAccounts.$inferSelect;
export type NewServiceAccount = typeof serviceAccounts.$inferInsert;
