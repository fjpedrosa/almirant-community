import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspace } from "./workspace";
import { projects } from "./projects";
import { user } from "./auth";
import { agentJobs } from "./agent-jobs";
import {
  handbookCaptureProposalStatusEnum,
  handbookEntrySourceTypeEnum,
  handbookEntryStatusEnum,
} from "./enums";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const vector1536 = customType<{ data: number[] }>({
  dataType() {
    return "vector(1536)";
  },
});

/**
 * Curated organizational implementation knowledge.
 * Almirant owns this lifecycle; external repositories are import seeds only.
 */
export const handbookEntries = pgTable(
  "handbook_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    slug: varchar("slug", { length: 500 }).notNull(),
    summary: text("summary"),
    content: text("content").notNull(),
    category: varchar("category", { length: 120 }).notNull().default("general"),
    status: handbookEntryStatusEnum("status").notNull().default("draft"),
    sourceType: handbookEntrySourceTypeEnum("source_type").notNull().default("manual"),
    sourcePath: text("source_path"),
    sourceProjectId: uuid("source_project_id").references(() => projects.id, { onDelete: "set null" }),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    searchVector: tsvector("search_vector"),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByAgentJobId: uuid("created_by_agent_job_id").references(() => agentJobs.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("handbook_entries_org_slug_unique_idx").on(table.workspaceId, table.slug),
    index("handbook_entries_org_status_idx").on(table.workspaceId, table.status),
    index("handbook_entries_org_category_idx").on(table.workspaceId, table.category),
    index("handbook_entries_source_project_idx").on(table.sourceProjectId),
    index("handbook_entries_archived_at_idx").on(table.archivedAt),
    index("handbook_entries_search_vector_idx").using("gin", table.searchVector),
  ],
);

export const handbookEntryVersions = pgTable(
  "handbook_entry_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => handbookEntries.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    summary: text("summary"),
    content: text("content").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    changeSummary: text("change_summary"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByAgentJobId: uuid("created_by_agent_job_id").references(() => agentJobs.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("handbook_entry_versions_entry_version_unique_idx").on(table.entryId, table.version),
    index("handbook_entry_versions_entry_idx").on(table.entryId),
    index("handbook_entry_versions_content_hash_idx").on(table.contentHash),
  ],
);

export const handbookChunks = pgTable(
  "handbook_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => handbookEntries.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    headingPath: text("heading_path"),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    embedding: vector1536("embedding"),
    searchVector: tsvector("search_vector"),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("handbook_chunks_entry_chunk_unique_idx").on(table.entryId, table.chunkIndex),
    index("handbook_chunks_entry_idx").on(table.entryId),
    index("handbook_chunks_search_vector_idx").using("gin", table.searchVector),
  ],
);

export const handbookCaptureProposals = pgTable(
  "handbook_capture_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    slug: varchar("slug", { length: 500 }).notNull(),
    summary: text("summary"),
    proposedContent: text("proposed_content").notNull(),
    category: varchar("category", { length: 120 }).notNull().default("general"),
    rationale: text("rationale"),
    status: handbookCaptureProposalStatusEnum("status").notNull().default("pending"),
    sourceProjectId: uuid("source_project_id").references(() => projects.id, { onDelete: "set null" }),
    sourceFiles: jsonb("source_files").default([]).$type<string[]>(),
    targetEntryId: uuid("target_entry_id").references((): AnyPgColumn => handbookEntries.id, { onDelete: "set null" }),
    reviewedByUserId: text("reviewed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    createdByAgentJobId: uuid("created_by_agent_job_id").references(() => agentJobs.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("handbook_capture_proposals_org_status_idx").on(table.workspaceId, table.status),
    index("handbook_capture_proposals_source_project_idx").on(table.sourceProjectId),
    index("handbook_capture_proposals_target_entry_idx").on(table.targetEntryId),
    index("handbook_capture_proposals_slug_idx").on(table.slug),
  ],
);

export const handbookSearchVector = (title: unknown, summary: unknown, content: unknown) => sql`
  setweight(to_tsvector('spanish', coalesce(${title}, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(${title}, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(${summary}, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(${summary}, '')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(${content}, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(${content}, '')), 'C')
`;

export type HandbookEntry = typeof handbookEntries.$inferSelect;
export type NewHandbookEntry = typeof handbookEntries.$inferInsert;
export type HandbookEntryVersion = typeof handbookEntryVersions.$inferSelect;
export type NewHandbookEntryVersion = typeof handbookEntryVersions.$inferInsert;
export type HandbookChunk = typeof handbookChunks.$inferSelect;
export type NewHandbookChunk = typeof handbookChunks.$inferInsert;
export type HandbookCaptureProposal = typeof handbookCaptureProposals.$inferSelect;
export type NewHandbookCaptureProposal = typeof handbookCaptureProposals.$inferInsert;
