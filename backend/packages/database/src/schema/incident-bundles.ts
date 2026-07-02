import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  text,
  index,
} from "drizzle-orm/pg-core";
import { feedbackItems } from "./feedback-items";
import { agentJobs } from "./agent-jobs";
import { workspace } from "./workspace";

export type IncidentBundleData = {
  version: 1;
  feedback: {
    id: string;
    title: string;
    content: string | null;
    category: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  } | null;
  job: {
    id: string;
    status: string;
    jobType: string;
    skillName: string | null;
    config: Record<string, unknown>;
    errorMessage: string | null;
  } | null;
  sessionEvents: Array<{
    sequenceNum: number;
    kind: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
  jobLogs: Array<{
    phase: string;
    eventType: string;
    level: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
  frontendTrace: Array<{
    t: number;
    kind: string;
    label: string;
    traceId?: string;
    jobId?: string;
    sessionId?: string;
    meta?: Record<string, unknown>;
  }> | null;
  errorMemory: Array<{
    type: string;
    topicKey: string;
    title: string;
    content: string;
  }>;
};

export const incidentBundles = pgTable(
  "incident_bundles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedbackItemId: uuid("feedback_item_id").references(() => feedbackItems.id, {
      onDelete: "cascade",
    }),
    agentJobId: uuid("agent_job_id").references(() => agentJobs.id, {
      onDelete: "set null",
    }),
    traceId: varchar("trace_id", { length: 64 }),
    workspaceId: text("workspace_id").references(() => workspace.id, {
      onDelete: "cascade",
    }),
    data: jsonb("data").$type<IncidentBundleData>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("incident_bundles_feedback_idx").on(t.feedbackItemId),
    index("incident_bundles_job_idx").on(t.agentJobId),
    index("incident_bundles_trace_idx").on(t.traceId),
  ]
);

export type IncidentBundle = typeof incidentBundles.$inferSelect;
export type NewIncidentBundle = typeof incidentBundles.$inferInsert;
