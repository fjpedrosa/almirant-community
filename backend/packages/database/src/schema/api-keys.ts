import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./organization";
import { user } from "./auth";
import { serviceAccounts } from "./service-accounts";

// API Keys for external agent access
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 128 }).notNull(),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  serviceAccountId: uuid("service_account_id").references(() => serviceAccounts.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  /**
   * MCP permission scopes this key is authorized to issue in session tokens.
   * Default: read/write only. Staff/runner keys can be upgraded to include
   * "mcp:internal" and "mcp:debug" for privileged access.
   */
  allowedIssuedPermissions: text("allowed_issued_permissions")
    .array()
    .notNull()
    .default(sql`ARRAY['mcp:read', 'mcp:write']::text[]`),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("api_keys_organization_id_idx").on(table.organizationId),
  index("api_keys_user_id_idx").on(table.userId),
  index("api_keys_service_account_id_idx").on(table.serviceAccountId),
  check("api_keys_owner_check", sql`"user_id" IS NOT NULL OR "service_account_id" IS NOT NULL`),
  check("api_keys_allowed_perms_check", sql`"allowed_issued_permissions" <@ ARRAY['mcp:read','mcp:write','mcp:internal','mcp:debug']::text[]`),
]);

// Type exports
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
