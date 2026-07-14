import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  index,
  uniqueIndex,
  varchar,
  boolean,
} from "drizzle-orm/pg-core";
import {
  agentJobStatusEnum,
  agentJobTypeEnum,
  agentProviderEnum,
  codingAgentEnum,
  aiProviderEnum,
  workerStatusEnum,
  priorityEnum,
  triggerTypeEnum,
} from "./enums";
import { projects } from "./projects";
import { workItems } from "./work-items";
import { boards } from "./boards";
import { planningSessions } from "./planning-sessions";
import { user } from "./auth";
import { workspace } from "./workspace";
import type { ProvenanceSource } from "./provenance";
import type {
  AgentWorkspace,
  ClusterInvestigationContext,
  EvidenceArtifactDescriptor,
  ResourceEstimate,
  RunnerCustomMcpServersConfig,
} from "@almirant/shared";

export interface AgentJobConfig {
  repoPath: string;
  baseBranch: string;
  repoUrl?: string;
  /** Human-readable execution label for session list/detail UX. */
  executionName?: string;
  /** Human-readable repository full name when the job is repository-scoped. */
  repositoryFullName?: string;
  /** First-class workspace source. Additive replacement for legacy repo fields. */
  workspace?: AgentWorkspace;
  /**
   * Additional remote MCP servers to inject into the runner for this job.
   * Platform-reserved servers such as `almirant`, `context7`, `memory`,
   * `filesystem`, etc. are built by the runner and cannot be overridden here.
   */
  mcpServers?: RunnerCustomMcpServersConfig;
  /** @deprecated The runner computes the Almirant MCP URL dynamically per job. */
  mcpServerUrl?: string;
  projectId?: string;
  /** Source scheduled-agent config UUID when a job is created from scheduled_agent_configs. */
  scheduledConfigId?: string;
  /** Human-readable scheduled-agent config name for session list UX and audit context. */
  scheduledConfigName?: string;
  skillName?: string;
  /** UUID of the skill in the skills table — when present, runner fetches content from DB */
  skillId?: string;
  /** Freeform prompt text for prompt-only jobs (e.g. scheduled agents) */
  prompt?: string;
  repositoryId?: string;
  taskId?: string;
  workItemTitle?: string;
  threadId?: string;
  // Planning-specific config
  seedIds?: string[];
  userMessage?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  sessionMode?: "planning" | "implementation" | "review";
  /** Surface that initiated the job — aligned with ProvenanceMetadata.source */
  source?: ProvenanceSource;
  /** Previous Definition of Done failure report injected by DoD remediation jobs. */
  dodReport?: string;
  /** Timestamp of the Definition of Done review that produced dodReport. */
  dodReviewedAt?: string;
  requestedByUserId?: string;
  planningSessionId?: string;
  /** Explicit override URL for walkthrough recording. Takes highest priority. */
  targetUrl?: string;
  /** Enables browser/Playwright MCP support for this runner job. */
  needsBrowser?: boolean;
  /**
   * Server-owned raster evidence references materialized by the runner as a
   * sidecar. This contract deliberately carries no blobs, base64, or URLs.
   */
  evidenceArtifacts?: EvidenceArtifactDescriptor[];
  /** Whether this job is a pre-warm placeholder (not yet a real planning job). */
  isPrewarm?: boolean;
  /** ID of the previous job attempt, set by stale recovery for session continuity */
  previousJobId?: string;
  /** Structured recovery context injected when resuming an interrupted planning session */
  recoveryContext?: string;
  /** User locale for i18n in agent prompts and progress updates (e.g. 'es', 'en') */
  locale?: string;
  /** Which coding agent to use for this job (e.g. claude-code, codex, opencode) */
  codingAgent?: "claude-code" | "codex" | "opencode";
  /** Explicit model override (e.g. claude-opus-4-8, glm-5.2). Takes priority over provider defaults. */
  model?: string;
  /** Explicit reasoning effort override for this job. Runtime-specific values are normalized by shims. */
  reasoningLevel?: string;
  /**
   * Opt-in "ultracode" preset. When true, the runner forces maximum reasoning
   * ("xhigh") and enables multi-agent teaming for the coding agent, regardless
   * of runtime. When absent, behavior is unchanged. Lives in the jsonb config
   * blob (no dedicated DB column).
   */
  ultracode?: boolean;
  /**
   * Explicit model to use for spawned subagents when teaming is active. When
   * omitted, teaming falls back to the resolved job model. Lives in the jsonb
   * config blob (no dedicated DB column).
   */
  subagentModel?: string;
  /**
   * UUID of the specific `provider_connections` row the runner should use for
   * AI credentials. Set by `createJob` when the admin has pinned an account
   * for the job's skill in system_settings.agent_routing. The runner
   * forwards this as `preferredConnectionId` to `/workers/provider-keys`,
   * short-circuiting the org's default resolution order.
   */
  providerConnectionId?: string;
  /** Whether the runner should operate in a read-only or write-capable workspace. */
  workspaceIntent?: "read-only" | "write";
  /** Whether the runner should push branch changes automatically when the session ends successfully. */
  postSessionPushPolicy?: "never" | "on-success";
  /**
   * When true, the runner skips its PR-first flow (no pre-draft `almirant/job-<shortId>`
   * branch/PR is created) because the skill creates and manages its own branch
   * and pull request via MCP tools. Used by `feedback-bug-fix` to avoid
   * producing an orphan draft PR alongside the real one.
   *
   * This flag is INDEPENDENT from `postSessionPushPolicy`: the safety-net
   * post-session push is still governed by the push policy.
   */
  selfManagesPr?: boolean;
  // Bug fix pipeline config
  bugFixAttemptId?: string;
  domain?: string;
  feedbackItemId?: string;
  /**
   * Batch of feedback item UUIDs processed together by the `feedback-triage-batch`
   * skill. Coexists with the singular `feedbackItemId` used by per-item flows.
   */
  feedbackItemIds?: string[];
  /** When set, the feedback-bug skill loads ALL items in this cluster as evidence (cluster-level investigation). feedbackItemId remains the primary/anchor item. */
  clusterId?: string;
  /**
   * Optional pre-built investigation context (cluster bug-fix flow). When provided,
   * the agent receives priorAttempts, statusHistory, sampleTickets, error_search
   * results, and aggregates without having to re-fetch them. Other skills ignore
   * this field.
   */
  investigationContext?: ClusterInvestigationContext;
  // Debug / observability

  /** Estimated RAM required by this job, computed before scheduling when available. */
  resourceEstimate?: ResourceEstimate;
  /** W3C-style correlation ID that ties this job to its originating HTTP request or WS message */
  traceId?: string;
  /** UUID of the incident bundle being analyzed (incident-analyze jobs) */
  bundleId?: string;
  /** UUID of the integration batch being processed (integration jobs) */
  batchId?: string;
  /** Sub-type for integration jobs: "process" (run replay) or "merge" (release approved batch) */
  integrationPhase?: "process" | "merge";
}

export interface AgentJobResult {
  summary: string;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
}

export interface WorkerConfig {
  providers: Array<"claude-code" | "codex" | "zipu" | "grok">;
  maxConcurrentAgents: number;
  projects: string[];
}

export const agentJobs = pgTable(
  "agent_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    planningSessionId: uuid("planning_session_id").references(() => planningSessions.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "set null" }),

    // Legacy columns (nullable — replaced by prompt + trigger model)
    jobType: agentJobTypeEnum("job_type").default("implementation"),
    skillName: varchar("skill_name", { length: 100 }),

    status: agentJobStatusEnum("status").notNull().default("queued"),
    provider: agentProviderEnum("provider").notNull(),
    codingAgent: codingAgentEnum("coding_agent").notNull().default("claude-code"),
    aiProvider: aiProviderEnum("ai_provider").notNull().default("anthropic"),
    model: varchar("model", { length: 100 }).notNull().default("claude-opus-4-8"),
    priority: priorityEnum("priority").notNull().default("medium"),

    // New model columns (prompt + trigger)
    prompt: text("prompt"),
    promptTemplate: varchar("prompt_template", { length: 100 }),
    triggerType: triggerTypeEnum("trigger_type").default("event"),
    interactive: boolean("interactive").default(false),
    dialogOwnerUserId: text("dialog_owner_user_id").references(() => user.id, { onDelete: "set null" }),
    dialogSubject: varchar("dialog_subject", { length: 200 }),
    idleGraceUntil: timestamp("idle_grace_until", { withTimezone: true }),

    config: jsonb("config").$type<AgentJobConfig>().notNull(),
    result: jsonb("result").$type<AgentJobResult>(),

    workerId: text("worker_id"),
    branchName: varchar("branch_name", { length: 255 }),
    worktreePath: text("worktree_path"),

    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(2),

    // If set, the job is not claimable until this timestamp (used for backoff retries).
    availableAt: timestamp("available_at", { withTimezone: true }),

    sessionId: varchar("session_id", { length: 255 }),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),

    errorMessage: text("error_message"),
    errorType: varchar("error_type", { length: 255 }),

    prUrl: text("pr_url"),
    prNumber: integer("pr_number"),
    commitSha: varchar("commit_sha", { length: 64 }),

    cost: numeric("cost"),
    tokensUsed: integer("tokens_used"),
    durationMs: integer("duration_ms"),
    cumulativeDurationMs: integer("cumulative_duration_ms").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_jobs_status_idx").on(table.status),
    index("agent_jobs_work_item_idx").on(table.workItemId),
    index("agent_jobs_project_idx").on(table.projectId),
    index("agent_jobs_worker_idx").on(table.workerId),
    index("agent_jobs_planning_session_idx").on(table.planningSessionId),
    index("agent_jobs_created_at_idx").on(table.createdAt),
    index("agent_jobs_created_by_user_idx").on(table.createdByUserId),
    index("agent_jobs_workspace_idx").on(table.workspaceId),
  ]
);

export const workerRegistrations = pgTable(
  "worker_registrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workerId: text("worker_id").notNull(),
    hostname: text("hostname").notNull(),
    currentIp: text("current_ip"),
    status: workerStatusEnum("status").notNull().default("offline"),
    config: jsonb("config")
      .$type<WorkerConfig>()
      .notNull()
      .default({ providers: [], maxConcurrentAgents: 2, projects: [] }),
    activeJobs: integer("active_jobs").notNull().default(0),
    maxConcurrentAgents: integer("max_concurrent_agents").notNull().default(2),
    isDraining: boolean("is_draining").notNull().default(false),
    availableSlots: integer("available_slots").notNull().default(0),
    ramBudgetMb: integer("ram_budget_mb"),
    ramCommittedMb: integer("ram_committed_mb"),
    ramAvailableMb: integer("ram_available_mb"),
    systemMetrics: jsonb("system_metrics"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("worker_registrations_worker_id_unique_idx").on(table.workerId),
    uniqueIndex("worker_registrations_hostname_unique_idx").on(table.hostname),
    index("worker_registrations_worker_id_idx").on(table.workerId),
    index("worker_registrations_status_idx").on(table.status),
  ]
);

export type AgentJobDb = typeof agentJobs.$inferSelect;
export type NewAgentJob = typeof agentJobs.$inferInsert;
export type WorkerRegistrationDb = typeof workerRegistrations.$inferSelect;
export type NewWorkerRegistration = typeof workerRegistrations.$inferInsert;
