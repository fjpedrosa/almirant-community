import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  index,
  unique,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { mcpVisibilityEnum, mcpAuthTypeEnum } from "./enums";
import { workspace } from "./workspace";
import { projects } from "./projects";
import { user } from "./auth";
import { scheduledAgentConfigs } from "./scheduled-agent-configs";

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").references(() => workspace.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    description: text("description"),
    // Connection endpoint for the MCP server.
    url: text("url").notNull(),
    // Transport kind (e.g. "remote", "stdio"). Kept as a free-form varchar to
    // stay forward-compatible with new transports without a schema migration.
    transport: varchar("transport", { length: 50 }).notNull().default("remote"),
    visibility: mcpVisibilityEnum("visibility").notNull().default("user"),
    authType: mcpAuthTypeEnum("auth_type").notNull().default("none"),
    // Header name used when authType = "custom_header" (e.g. "X-Api-Key").
    authHeaderName: varchar("auth_header_name", { length: 255 }),
    templateKey: varchar("template_key", { length: 64 }),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // AES-GCM envelope for the auth secret (mirrors provider_connections).
    keyVersion: integer("key_version").notNull().default(1),
    encryptedCredentials: text("encrypted_credentials"),
    credentialsIv: text("credentials_iv"),
    credentialsAuthTag: text("credentials_auth_tag"),
    version: integer("version").notNull().default(1),
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
    // NULLS NOT DISTINCT so a NULL workspaceId/projectId scope (e.g. official
    // servers) still collides on duplicate slugs. Postgres treats NULLs as
    // distinct by default, which would otherwise allow duplicate global slugs.
    unique("mcp_servers_slug_scope_idx")
      .on(table.slug, table.workspaceId, table.projectId, table.ownerUserId)
      .nullsNotDistinct(),
    index("mcp_servers_workspace_id_idx").on(table.workspaceId),
    index("mcp_servers_project_id_idx").on(table.projectId),
    index("mcp_servers_owner_user_id_idx").on(table.ownerUserId),
    index("mcp_servers_visibility_idx").on(table.visibility),
    index("mcp_servers_template_key_idx").on(table.templateKey),
    index("mcp_servers_archived_at_idx").on(table.archivedAt),
  ]
);

export const scheduledAgentMcpServers = pgTable(
  "scheduled_agent_mcp_servers",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => scheduledAgentConfigs.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.mcpServerId] }),
    index("scheduled_agent_mcp_servers_mcp_server_id_idx").on(
      table.mcpServerId
    ),
  ]
);

export type McpServerDb = typeof mcpServers.$inferSelect;
export type NewMcpServer = typeof mcpServers.$inferInsert;

export type ScheduledAgentMcpServerDb =
  typeof scheduledAgentMcpServers.$inferSelect;
export type NewScheduledAgentMcpServer =
  typeof scheduledAgentMcpServers.$inferInsert;
