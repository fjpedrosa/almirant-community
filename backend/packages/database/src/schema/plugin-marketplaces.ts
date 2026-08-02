import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { workspace } from "./workspace";

export type PluginMarketplaceProvider = "claude-code" | "opencode";
export type PluginMarketplaceSourceType = "github" | "url" | "npm";

export const pluginMarketplaces = pgTable(
  "plugin_marketplaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    provider: varchar("provider", { length: 50 })
      .$type<PluginMarketplaceProvider>()
      .notNull()
      .default("claude-code"),
    source: text("source").notNull(),
    sourceType: varchar("source_type", { length: 32 })
      .$type<PluginMarketplaceSourceType>()
      .notNull()
      .default("github"),
    catalog: jsonb("catalog").$type<Record<string, unknown> | null>(),
    enabled: boolean("enabled").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
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
    unique("plugin_marketplaces_slug_workspace_idx")
      .on(table.slug, table.workspaceId, table.ownerUserId)
      .nullsNotDistinct(),
    index("plugin_marketplaces_workspace_id_idx").on(table.workspaceId),
    index("plugin_marketplaces_owner_user_id_idx").on(table.ownerUserId),
    index("plugin_marketplaces_provider_idx").on(table.provider),
    check(
      "plugin_marketplaces_provider_check",
      sql`${table.provider} IN ('claude-code', 'opencode')`,
    ),
    check(
      "plugin_marketplaces_source_type_check",
      sql`${table.sourceType} IN ('github', 'url', 'npm')`,
    ),
  ],
);

export type PluginMarketplaceDb = typeof pluginMarketplaces.$inferSelect;
export type NewPluginMarketplace = typeof pluginMarketplaces.$inferInsert;
