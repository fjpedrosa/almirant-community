import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  varchar,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bugFixAttemptStatusEnum, bugDomainEnum } from "./enums";
import { feedbackItems } from "./feedback-items";
import { feedbackClusters } from "./feedback-clusters";
import { projects } from "./projects";
import { workspace } from "./workspace";
import { agentJobs } from "./agent-jobs";

export const bugFixAttempts = pgTable(
  "bug_fix_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable — a bug fix attempt can target either a single feedback item
    // OR a cluster. The CHECK constraint below enforces that at least one is set.
    feedbackItemId: uuid("feedback_item_id")
      .references(() => feedbackItems.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id")
      .references(() => feedbackClusters.id, { onDelete: "set null" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    agentJobId: uuid("agent_job_id")
      .references(() => agentJobs.id, { onDelete: "set null" }),
    domain: bugDomainEnum("domain"),
    rootCause: text("root_cause"),
    solutionProposed: text("solution_proposed"),
    filesAffected: jsonb("files_affected").$type<string[]>(),
    fixBranch: varchar("fix_branch", { length: 255 }),
    fixPrUrl: text("fix_pr_url"),
    fixPrNumber: integer("fix_pr_number"),
    status: bugFixAttemptStatusEnum("status").notNull().default("analyzing"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    failureReason: text("failure_reason"),
    failureDetectedBy: varchar("failure_detected_by", { length: 20 }),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("bug_fix_attempts_feedback_item_id_idx").on(table.feedbackItemId),
    index("bug_fix_attempts_cluster_id_idx").on(table.clusterId),
    index("bug_fix_attempts_project_id_idx").on(table.projectId),
    index("bug_fix_attempts_status_idx").on(table.status),
    index("bug_fix_attempts_agent_job_id_idx").on(table.agentJobId),
    uniqueIndex("bug_fix_attempts_feedback_attempt_number_unique_idx")
      .on(table.feedbackItemId, table.attemptNumber)
      .where(sql`${table.clusterId} IS NULL`),
    uniqueIndex("bug_fix_attempts_feedback_active_unique_idx")
      .on(table.feedbackItemId)
      .where(
        sql`${table.clusterId} IS NULL AND ${table.status} IN ('analyzing', 'proposed', 'implementing')`
      ),
    uniqueIndex("bug_fix_attempts_cluster_active_unique_idx")
      .on(table.clusterId)
      .where(
        sql`${table.clusterId} IS NOT NULL AND ${table.status} IN ('analyzing', 'proposed', 'implementing')`
      ),
    // Ensure attempt_number is unique per cluster for cluster-scoped attempts.
    uniqueIndex("bug_fix_attempts_cluster_attempt_number_unique_idx")
      .on(table.clusterId, table.attemptNumber)
      .where(sql`${table.clusterId} IS NOT NULL`),
    // Supports the zombie-investigation sweeper (A-F-443): find active
    // attempts older than N minutes. Partial index keeps it tiny.
    index("bug_fix_attempts_active_created_at_idx")
      .on(table.createdAt)
      .where(sql`${table.status} IN ('analyzing', 'proposed', 'implementing')`),
    // Require a target (feedback item or cluster) for every attempt.
    check(
      "bug_fix_attempts_target_required",
      sql`${table.feedbackItemId} IS NOT NULL OR ${table.clusterId} IS NOT NULL`
    ),
  ]
);

export type BugFixAttempt = typeof bugFixAttempts.$inferSelect;
export type NewBugFixAttempt = typeof bugFixAttempts.$inferInsert;
