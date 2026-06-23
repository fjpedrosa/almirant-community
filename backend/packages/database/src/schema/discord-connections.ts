import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./organization";
import { projects } from "./projects";

export const discordConnections = pgTable(
  "discord_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    guildId: varchar("guild_id", { length: 255 }).notNull(),
    guildName: varchar("guild_name", { length: 255 }),
    defaultChannelId: varchar("default_channel_id", { length: 255 }),
    defaultChannelName: varchar("default_channel_name", { length: 255 }),
    encryptedAccessToken: text("encrypted_access_token"),
    accessTokenIv: text("access_token_iv"),
    accessTokenAuthTag: text("access_token_auth_tag"),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    refreshTokenIv: text("refresh_token_iv"),
    refreshTokenAuthTag: text("refresh_token_auth_tag"),
    botJoinedAt: timestamp("bot_joined_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("discord_connections_organization_id_idx").on(table.organizationId),
    uniqueIndex("discord_connections_org_guild_unique").on(
      table.organizationId,
      table.guildId,
    ),
  ]
);

export const discordProjectChannels = pgTable(
  "discord_project_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordConnectionId: uuid("discord_connection_id")
      .notNull()
      .references(() => discordConnections.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    channelId: varchar("channel_id", { length: 255 }).notNull(),
    channelName: varchar("channel_name", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("discord_project_channels_connection_project_unique").on(
      table.discordConnectionId,
      table.projectId,
    ),
  ]
);

export const discordNotificationPreferences = pgTable(
  "discord_notification_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discordConnectionId: uuid("discord_connection_id")
      .notNull()
      .references(() => discordConnections.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    enabled: boolean("enabled").default(true).notNull(),
    // Events defaulting to ON (true)
    notifyWorkItemCreated: boolean("notify_work_item_created")
      .default(true)
      .notNull(),
    notifyWorkItemMoved: boolean("notify_work_item_moved")
      .default(true)
      .notNull(),
    notifyWorkItemAssigned: boolean("notify_work_item_assigned")
      .default(true)
      .notNull(),
    notifyWorkItemDone: boolean("notify_work_item_done")
      .default(true)
      .notNull(),
    notifyWorkItemComment: boolean("notify_work_item_comment")
      .default(true)
      .notNull(),
    notifySprintStarted: boolean("notify_sprint_started")
      .default(true)
      .notNull(),
    notifySprintClosed: boolean("notify_sprint_closed")
      .default(true)
      .notNull(),
    notifyMilestoneCompleted: boolean("notify_milestone_completed")
      .default(true)
      .notNull(),
    notifyPrOpened: boolean("notify_pr_opened").default(true).notNull(),
    notifyPrMerged: boolean("notify_pr_merged").default(true).notNull(),
    notifyCiFailed: boolean("notify_ci_failed").default(true).notNull(),
    notifyAgentJobCompleted: boolean("notify_agent_job_completed")
      .default(true)
      .notNull(),
    notifyAgentJobFailed: boolean("notify_agent_job_failed")
      .default(true)
      .notNull(),
    notifySeedPromoted: boolean("notify_seed_promoted")
      .default(true)
      .notNull(),
    // Events defaulting to OFF (false)
    notifyWorkItemUpdated: boolean("notify_work_item_updated")
      .default(false)
      .notNull(),
    notifyWorkItemDeleted: boolean("notify_work_item_deleted")
      .default(false)
      .notNull(),
    notifyCommentAdded: boolean("notify_comment_added")
      .default(false)
      .notNull(),
    notifyAttachmentAdded: boolean("notify_attachment_added")
      .default(false)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // For project-level rows (projectId IS NOT NULL)
    uniqueIndex("discord_notif_prefs_connection_project_unique").on(
      table.discordConnectionId,
      table.projectId,
    ),
    // For org-level rows (projectId IS NULL) — only one per connection
    uniqueIndex("discord_notif_prefs_connection_org_unique")
      .on(table.discordConnectionId)
      .where(sql`${table.projectId} IS NULL`),
  ]
);

// Type exports
export type DiscordConnection = typeof discordConnections.$inferSelect;
export type NewDiscordConnection = typeof discordConnections.$inferInsert;
export type DiscordProjectChannel = typeof discordProjectChannels.$inferSelect;
export type NewDiscordProjectChannel = typeof discordProjectChannels.$inferInsert;
export type DiscordNotificationPreference =
  typeof discordNotificationPreferences.$inferSelect;
export type NewDiscordNotificationPreference =
  typeof discordNotificationPreferences.$inferInsert;
