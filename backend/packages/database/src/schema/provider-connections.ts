import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  providerTypeEnum,
  connectionCategoryEnum,
  connectionScopeEnum,
} from "./enums";
import { user } from "./auth";

export const providerConnections = pgTable("provider_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: providerTypeEnum("provider").notNull(),
  category: connectionCategoryEnum("category").notNull(),
  scope: connectionScopeEnum("scope").notNull(),
  scopeId: text("scope_id").notNull(),
  createdByUserId: text("created_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  name: varchar("name", { length: 255 }).notNull(),
  accountIdentifier: varchar("account_identifier", { length: 255 }),
  isActive: boolean("is_active").default(true).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  orchestrationEnabled: boolean("orchestration_enabled").default(false).notNull(),
  priority: integer("priority").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  lastValidationStatus: text("last_validation_status"),
  lastValidationError: text("last_validation_error"),
  encryptedCredentials: text("encrypted_credentials"),
  credentialsIv: text("credentials_iv"),
  credentialsAuthTag: text("credentials_auth_tag"),
  config: jsonb("config").default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (table) => [
  index("provider_connections_scope_provider_idx").on(
    table.scope,
    table.scopeId,
    table.provider,
  ),
  index("provider_connections_created_by_user_id_idx").on(
    table.createdByUserId,
  ),
  index("provider_connections_category_scope_idx").on(
    table.category,
    table.scope,
    table.scopeId,
  ),
  index("provider_connections_active_idx")
    .on(table.isActive)
    .where(sql`is_active = true`),
  uniqueIndex("provider_connections_default_unique_idx")
    .on(table.provider, table.scope, table.scopeId)
    .where(sql`is_default = true AND is_active = true`),
]);

// Type exports
export type ProviderConnection = typeof providerConnections.$inferSelect;
export type NewProviderConnection = typeof providerConnections.$inferInsert;
