import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  unique,
  jsonb,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspace } from "./workspace";
import { user } from "./auth";
import { pluginMarketplaces } from "./plugin-marketplaces";
import { userStorageObjects } from "./user-storage";

export type AgentPluginVisibility = "user" | "workspace" | "official";
export type AgentPluginProvider = "portable" | "claude-code" | "opencode" | "codex";
export type AgentPluginSourceType = "instructions" | "marketplace" | "upload";

export const agentPlugins = pgTable(
  "agent_plugins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    instructions: text("instructions").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    visibility: varchar("visibility", { length: 32 })
      .$type<AgentPluginVisibility>()
      .notNull()
      .default("workspace"),
    provider: varchar("provider", { length: 50 })
      .$type<AgentPluginProvider>()
      .notNull()
      .default("portable"),
    sourceType: varchar("source_type", { length: 32 })
      .$type<AgentPluginSourceType>()
      .notNull()
      .default("instructions"),
    marketplaceId: uuid("marketplace_id").references(() => pluginMarketplaces.id, {
      onDelete: "cascade",
    }),
    externalId: varchar("external_id", { length: 255 }),
    sourceReference: text("source_reference"),
    version: varchar("version", { length: 100 }),
    checksumSha256: varchar("checksum_sha256", { length: 64 }),
    storageObjectId: uuid("storage_object_id").references(() => userStorageObjects.id, {
      onDelete: "set null",
    }),
    manifest: jsonb("manifest").$type<Record<string, unknown> | null>(),
    enabled: boolean("enabled").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
    unique("agent_plugins_slug_workspace_owner_idx")
      .on(table.slug, table.workspaceId, table.ownerUserId)
      .nullsNotDistinct(),
    index("agent_plugins_workspace_id_idx").on(table.workspaceId),
    index("agent_plugins_owner_user_id_idx").on(table.ownerUserId),
    index("agent_plugins_marketplace_id_idx").on(table.marketplaceId),
    index("agent_plugins_storage_object_id_idx").on(table.storageObjectId),
    index("agent_plugins_archived_at_idx").on(table.archivedAt),
    check(
      "agent_plugins_visibility_check",
      sql`${table.visibility} IN ('user', 'workspace', 'official')`,
    ),
    check(
      "agent_plugins_provider_check",
      sql`${table.provider} IN ('portable', 'claude-code', 'opencode', 'codex')`,
    ),
    check(
      "agent_plugins_source_type_check",
      sql`${table.sourceType} IN ('instructions', 'marketplace', 'upload')`,
    ),
  ],
);

export type AgentPluginDb = typeof agentPlugins.$inferSelect;
export type NewAgentPlugin = typeof agentPlugins.$inferInsert;
