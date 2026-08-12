import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  noteLegacyDispositionEnum,
  noteLegacySourceTypeEnum,
  noteActorKindEnum,
  notePageKindEnum,
  notePageProvenanceEnum,
  notePageShareRoleEnum,
  notePageVisibilityEnum,
} from "./enums";
import { user } from "./auth";
import { agentJobs } from "./agent-jobs";
import { workspace } from "./workspace";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const notePages = pgTable(
  "note_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => notePages.id, { onDelete: "restrict" }),
    kind: notePageKindEnum("kind").notNull().default("page"),
    dailyDate: date("daily_date", { mode: "string" }),
    visibility: notePageVisibilityEnum("visibility").notNull().default("private"),
    title: text("title").notNull().default(""),
    position: integer("position").notNull().default(0),
    lexicalJson: jsonb("lexical_json").notNull().default({ root: { type: "root", version: 1, children: [] } }).$type<Record<string, unknown>>(),
    lexicalSchemaVersion: integer("lexical_schema_version").notNull().default(1),
    markdownProjection: text("markdown_projection").notNull().default(""),
    plaintextProjection: text("plaintext_projection").notNull().default(""),
    searchVector: tsvector("search_vector").notNull().default(sql`to_tsvector('simple', '')`),
    stateVersion: integer("state_version").notNull().default(1),
    provenance: notePageProvenanceEnum("provenance").notNull().default("user"),
    createdByKind: noteActorKindEnum("created_by_kind").notNull().default("user"),
    updatedByKind: noteActorKindEnum("updated_by_kind").notNull().default("user"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "restrict" }),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "restrict" }),
    createdByAgentJobId: uuid("created_by_agent_job_id").references(() => agentJobs.id, { onDelete: "restrict" }),
    updatedByAgentJobId: uuid("updated_by_agent_job_id").references(() => agentJobs.id, { onDelete: "restrict" }),
    createdByChannel: text("created_by_channel"),
    updatedByChannel: text("updated_by_channel"),
    createdByTool: text("created_by_tool"),
    updatedByTool: text("updated_by_tool"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("note_pages_id_workspace_unique").on(table.id, table.workspaceId),
    uniqueIndex("note_pages_daily_unique_idx").on(table.workspaceId, table.ownerUserId, table.dailyDate).where(sql`${table.kind} = 'daily' AND ${table.dailyDate} IS NOT NULL`),
    index("note_pages_workspace_parent_position_idx").on(table.workspaceId, table.parentId, table.position),
    index("note_pages_workspace_owner_idx").on(table.workspaceId, table.ownerUserId),
    index("note_pages_search_vector_idx").using("gin", table.searchVector),
    index("note_pages_daily_date_idx").on(table.workspaceId, table.dailyDate),
    check("note_pages_position_nonnegative", sql`${table.position} >= 0`),
    check("note_pages_state_version_positive", sql`${table.stateVersion} >= 1`),
    check("note_pages_kind_daily_date_check", sql`(${table.kind} = 'daily' AND ${table.dailyDate} IS NOT NULL) OR (${table.kind} = 'page' AND ${table.dailyDate} IS NULL)`),
    check("note_pages_created_actor_check", sql`(${table.createdByKind} = 'user' AND ${table.createdByUserId} IS NOT NULL AND ${table.createdByAgentJobId} IS NULL) OR (${table.createdByKind} = 'agent' AND ${table.createdByUserId} IS NOT NULL AND ${table.createdByAgentJobId} IS NOT NULL)`),
    check("note_pages_updated_actor_check", sql`(${table.updatedByKind} = 'user' AND ${table.updatedByUserId} IS NOT NULL AND ${table.updatedByAgentJobId} IS NULL) OR (${table.updatedByKind} = 'agent' AND ${table.updatedByUserId} IS NOT NULL AND ${table.updatedByAgentJobId} IS NOT NULL)`),
    foreignKey({ columns: [table.parentId, table.workspaceId], foreignColumns: [table.id, table.workspaceId], name: "note_pages_parent_workspace_fk" }),
  ],
);

export const notePageShares = pgTable(
  "note_page_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pageId: uuid("page_id").notNull().references(() => notePages.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    sharedWithUserId: text("shared_with_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    role: notePageShareRoleEnum("role").notNull().default("viewer"),
    actorKind: noteActorKindEnum("actor_kind").notNull().default("user"),
    actorAgentJobId: uuid("actor_agent_job_id").references(() => agentJobs.id, { onDelete: "restrict" }),
    actorChannel: text("actor_channel"),
    actorTool: text("actor_tool"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("note_page_shares_page_user_unique_idx").on(table.pageId, table.sharedWithUserId),
    index("note_page_shares_workspace_user_idx").on(table.workspaceId, table.sharedWithUserId),
    index("note_page_shares_page_role_idx").on(table.pageId, table.role),
    check("note_page_shares_actor_check", sql`(${table.actorKind} <> 'agent' AND ${table.actorAgentJobId} IS NULL) OR (${table.actorKind} = 'agent' AND ${table.actorAgentJobId} IS NOT NULL)`),
    foreignKey({ columns: [table.pageId, table.workspaceId], foreignColumns: [notePages.id, notePages.workspaceId], name: "note_page_shares_page_workspace_fk" }),
  ],
);

export const noteChecklistItems = pgTable(
  "note_checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id").notNull().defaultRandom(),
    pageId: uuid("page_id").notNull().references(() => notePages.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull().default(""),
    checked: boolean("checked").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByKind: noteActorKindEnum("completed_by_kind"),
    completedByUserId: text("completed_by_user_id").references(() => user.id, { onDelete: "restrict" }),
    completedByAgentJobId: uuid("completed_by_agent_job_id").references(() => agentJobs.id, { onDelete: "restrict" }),
    completedByChannel: text("completed_by_channel"),
    completedByTool: text("completed_by_tool"),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, { onDelete: "restrict" }),
    updatedByKind: noteActorKindEnum("updated_by_kind").notNull().default("user"),
    updatedByAgentJobId: uuid("updated_by_agent_job_id").references(() => agentJobs.id, { onDelete: "restrict" }),
    updatedByChannel: text("updated_by_channel"),
    updatedByTool: text("updated_by_tool"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("note_checklist_items_item_id_unique_idx").on(table.itemId),
    uniqueIndex("note_checklist_items_page_ordinal_unique_idx").on(table.pageId, table.ordinal),
    index("note_checklist_items_page_idx").on(table.pageId),
    check("note_checklist_items_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    check("note_checklist_items_completion_consistency", sql`((${table.checked} = true AND ${table.completedAt} IS NOT NULL AND ((${table.completedByKind} = 'user' AND ${table.completedByUserId} IS NOT NULL AND ${table.completedByAgentJobId} IS NULL) OR (${table.completedByKind} = 'agent' AND ${table.completedByAgentJobId} IS NOT NULL AND ${table.completedByUserId} IS NOT NULL))) IS TRUE OR (${table.checked} = false AND ${table.completedAt} IS NULL AND ${table.completedByUserId} IS NULL AND ${table.completedByAgentJobId} IS NULL AND ${table.completedByKind} IS NULL) IS TRUE)`),
    check("note_checklist_items_updated_actor_check", sql`(${table.updatedByKind} = 'user' AND ${table.updatedByUserId} IS NOT NULL AND ${table.updatedByAgentJobId} IS NULL) OR (${table.updatedByKind} = 'agent' AND ${table.updatedByUserId} IS NOT NULL AND ${table.updatedByAgentJobId} IS NOT NULL)`),
    foreignKey({ columns: [table.pageId, table.workspaceId], foreignColumns: [notePages.id, notePages.workspaceId], name: "note_checklist_items_page_workspace_fk" }),
  ],
);

export const notePageLinks = pgTable(
  "note_page_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
    sourcePageId: uuid("source_page_id").notNull().references(() => notePages.id, { onDelete: "cascade" }),
    targetPageId: uuid("target_page_id").notNull().references(() => notePages.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    anchorText: text("anchor_text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("note_page_links_source_ordinal_unique_idx").on(table.sourcePageId, table.ordinal),
    index("note_page_links_target_idx").on(table.targetPageId, table.ordinal),
    index("note_page_links_workspace_idx").on(table.workspaceId),
    check("note_page_links_ordinal_nonnegative", sql`${table.ordinal} >= 0`),
    foreignKey({ columns: [table.sourcePageId, table.workspaceId], foreignColumns: [notePages.id, notePages.workspaceId], name: "note_page_links_source_workspace_fk" }),
    foreignKey({ columns: [table.targetPageId, table.workspaceId], foreignColumns: [notePages.id, notePages.workspaceId], name: "note_page_links_target_workspace_fk" }),
  ],
);

export const noteLegacyArchiveItems = pgTable(
  "note_legacy_archive_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
    sourceType: noteLegacySourceTypeEnum("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    snapshot: jsonb("snapshot").notNull().$type<Record<string, unknown>>(),
    disposition: noteLegacyDispositionEnum("disposition").notNull().default("pending"),
    convertedPageId: uuid("converted_page_id").references(() => notePages.id, { onDelete: "restrict" }),
    convertedActionId: text("converted_action_id"),
    dispositionByUserId: text("disposition_by_user_id").references(() => user.id, { onDelete: "restrict" }),
    dispositionByKind: noteActorKindEnum("disposition_by_kind"),
    dispositionByAgentJobId: uuid("disposition_by_agent_job_id").references(() => agentJobs.id, { onDelete: "restrict" }),
    dispositionByChannel: text("disposition_by_channel"),
    dispositionByTool: text("disposition_by_tool"),
    dispositionAt: timestamp("disposition_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("note_legacy_archive_items_source_unique_idx").on(table.sourceType, table.sourceId),
    index("note_legacy_archive_items_pending_idx").on(table.workspaceId, table.disposition, table.createdAt),
    check("note_legacy_archive_items_state_check", sql`((${table.disposition} = 'pending' AND ${table.convertedPageId} IS NULL AND ${table.convertedActionId} IS NULL AND ${table.dispositionAt} IS NULL AND ${table.dispositionByUserId} IS NULL AND ${table.dispositionByAgentJobId} IS NULL AND ${table.dispositionByKind} IS NULL AND ${table.dispositionByChannel} IS NULL AND ${table.dispositionByTool} IS NULL) IS TRUE OR (${table.disposition} = 'converted' AND ${table.convertedPageId} IS NOT NULL AND ${table.convertedActionId} IS NOT NULL AND ${table.dispositionAt} IS NOT NULL AND ((${table.dispositionByKind} = 'user' AND ${table.dispositionByUserId} IS NOT NULL AND ${table.dispositionByAgentJobId} IS NULL) OR (${table.dispositionByKind} = 'agent' AND ${table.dispositionByAgentJobId} IS NOT NULL AND ${table.dispositionByUserId} IS NOT NULL))) IS TRUE OR (${table.disposition} = 'discarded' AND ${table.convertedPageId} IS NULL AND ${table.convertedActionId} IS NOT NULL AND ${table.dispositionAt} IS NOT NULL AND ((${table.dispositionByKind} = 'user' AND ${table.dispositionByUserId} IS NOT NULL AND ${table.dispositionByAgentJobId} IS NULL) OR (${table.dispositionByKind} = 'agent' AND ${table.dispositionByAgentJobId} IS NOT NULL AND ${table.dispositionByUserId} IS NOT NULL))) IS TRUE)`),
    uniqueIndex("note_legacy_archive_items_action_unique_idx").on(table.workspaceId, table.convertedActionId).where(sql`${table.convertedActionId} IS NOT NULL`),
    foreignKey({ columns: [table.convertedPageId, table.workspaceId], foreignColumns: [notePages.id, notePages.workspaceId], name: "note_legacy_archive_items_converted_page_workspace_fk" }),
  ],
);

export type NotePage = typeof notePages.$inferSelect;
export type NewNotePage = typeof notePages.$inferInsert;
export type NotePageShare = typeof notePageShares.$inferSelect;
export type NoteChecklistItem = typeof noteChecklistItems.$inferSelect;
export type NotePageLink = typeof notePageLinks.$inferSelect;
export type NoteLegacyArchiveItem = typeof noteLegacyArchiveItems.$inferSelect;
