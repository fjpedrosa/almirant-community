import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  index,
  uniqueIndex,
  customType,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { observationTypeEnum } from "./enums";
import { projects } from "./projects";
import { organization } from "./organization";
import { agentJobs } from "./agent-jobs";
import { user } from "./auth";
import { workItems } from "./work-items";
import { feedbackItems } from "./feedback-items";
import { memoryVisibilityEnum, memoryCreatedByKindEnum } from "./enums";

// Custom type for PostgreSQL tsvector (full-text search)
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
 * Agent memory system: stores observations (decisions, patterns, bugfixes, discoveries)
 * with native PostgreSQL full-text search via tsvector.
 */
export const agentObservations = pgTable(
  "agent_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    agentJobId: uuid("agent_job_id").references(() => agentJobs.id, {
      onDelete: "set null",
    }),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    visibility: memoryVisibilityEnum("visibility").notNull().default("project"),
    createdByKind: memoryCreatedByKindEnum("created_by_kind")
      .notNull()
      .default("agent"),
    workItemId: uuid("work_item_id").references(() => workItems.id, {
      onDelete: "set null",
    }),
    feedbackItemId: uuid("feedback_item_id").references(() => feedbackItems.id, {
      onDelete: "set null",
    }),
    supersedesObservationId: uuid("supersedes_observation_id").references(
      (): AnyPgColumn => agentObservations.id,
      {
        onDelete: "set null",
      }
    ),
    type: observationTypeEnum("type").notNull(),
    topicKey: varchar("topic_key", { length: 500 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    content: text("content").notNull(),
    scope: varchar("scope", { length: 500 }),
    revision: integer("revision").notNull().default(1),
    confidence: numeric("confidence", { precision: 3, scale: 2 })
      .notNull()
      .default("0.50"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    searchVector: tsvector("search_vector"),
    embedding: vector1536("embedding"),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    verifiedByUserId: text("verified_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_observations_organization_idx").on(table.organizationId),
    index("agent_observations_project_idx").on(table.projectId),
    index("agent_observations_agent_job_idx").on(table.agentJobId),
    index("agent_observations_owner_user_idx").on(table.ownerUserId),
    index("agent_observations_work_item_idx").on(table.workItemId),
    index("agent_observations_feedback_item_idx").on(table.feedbackItemId),
    index("agent_observations_type_idx").on(table.type),
    index("agent_observations_topic_key_idx").on(table.topicKey),
    index("agent_observations_visibility_idx").on(table.visibility),
    index("agent_observations_supersedes_idx").on(table.supersedesObservationId),
    index("agent_observations_verified_by_user_idx").on(table.verifiedByUserId),
    index("agent_observations_archived_at_idx").on(table.archivedAt),
    index("agent_observations_expires_at_idx").on(table.expiresAt),
    uniqueIndex("agent_observations_project_visibility_hash_unique_idx")
      .on(
        table.organizationId,
        table.projectId,
        table.contentHash
      )
      .where(
        sql`${table.visibility} = 'project' AND ${table.archivedAt} IS NULL`
      ),
    uniqueIndex("agent_observations_org_visibility_hash_unique_idx")
      .on(table.organizationId, table.contentHash)
      .where(sql`${table.visibility} = 'org' AND ${table.archivedAt} IS NULL`),
    uniqueIndex("agent_observations_personal_visibility_hash_unique_idx")
      .on(table.organizationId, table.ownerUserId, table.contentHash)
      .where(
        sql`${table.visibility} = 'personal' AND ${table.archivedAt} IS NULL`
      ),
    index("agent_observations_search_vector_idx").on(table.searchVector),
    check(
      "agent_observations_visibility_scope_check",
      sql`(
        (${table.visibility} = 'personal' AND ${table.ownerUserId} IS NOT NULL AND ${table.projectId} IS NULL)
        OR
        (${table.visibility} = 'project' AND ${table.projectId} IS NOT NULL AND ${table.ownerUserId} IS NULL)
        OR
        (${table.visibility} = 'org' AND ${table.projectId} IS NULL AND ${table.ownerUserId} IS NULL)
      )`
    ),
    check(
      "agent_observations_confidence_range_check",
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`
    ),
    check(
      "agent_observations_verification_consistency_check",
      sql`(
        (${table.verifiedByUserId} IS NULL AND ${table.verifiedAt} IS NULL)
        OR
        (${table.verifiedByUserId} IS NOT NULL AND ${table.verifiedAt} IS NOT NULL)
      )`
    ),
    check(
      "agent_observations_not_self_superseded_check",
      sql`${table.supersedesObservationId} IS NULL OR ${table.supersedesObservationId} <> ${table.id}`
    ),
  ]
);

// Type exports
export type AgentObservation = typeof agentObservations.$inferSelect;
export type NewAgentObservation = typeof agentObservations.$inferInsert;
