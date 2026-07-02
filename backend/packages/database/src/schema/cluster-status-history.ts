import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { feedbackClusterStatusEnum } from "./enums";
import { feedbackClusters } from "./feedback-clusters";
import { bugFixAttempts } from "./bug-fix-attempts";
import { agentJobs } from "./agent-jobs";
import { user } from "./auth";

/**
 * Audit trail of status transitions for feedback clusters.
 *
 * Every change to `feedback_clusters.status` MUST append a row here so we can
 * compute MTTR (mean time to resolution) metrics and detect toxic clusters
 * that oscillate between `resolved` and `regression`.
 *
 * `from_status` is nullable to allow the initial insertion of the cluster
 * (no prior state).
 *
 * `triggered_by_kind` uses a varchar(20) (not enum) to allow new actor kinds
 * without schema migrations. Current expected values: user | system | agent | webhook.
 */
export const clusterStatusHistory = pgTable(
  "cluster_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => feedbackClusters.id, { onDelete: "cascade" }),
    fromStatus: feedbackClusterStatusEnum("from_status"),
    toStatus: feedbackClusterStatusEnum("to_status").notNull(),
    triggeredByKind: varchar("triggered_by_kind", { length: 20 }).notNull(),
    triggeredByUserId: text("triggered_by_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    triggeredByAttemptId: uuid("triggered_by_attempt_id").references(
      () => bugFixAttempts.id,
      { onDelete: "set null" }
    ),
    triggeredByAgentJobId: uuid("triggered_by_agent_job_id").references(
      () => agentJobs.id,
      { onDelete: "set null" }
    ),
    reason: varchar("reason", { length: 2000 }),
    metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("cluster_status_history_cluster_id_idx").on(table.clusterId),
    index("cluster_status_history_cluster_changed_at_idx").on(
      table.clusterId,
      table.changedAt
    ),
  ]
);

export type ClusterStatusHistory = typeof clusterStatusHistory.$inferSelect;
export type NewClusterStatusHistory = typeof clusterStatusHistory.$inferInsert;
