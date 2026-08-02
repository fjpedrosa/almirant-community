import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agentJobTypeEnum, agentProviderEnum } from "./enums";
import { workspace } from "./workspace";
import { projects } from "./projects";
import { skills } from "./skills";
import { user } from "./auth";
import type { BacklogDrainConfig } from "../repositories/agents/backlog-drain-selection";
import type { RunnerCustomMcpServersConfig } from "@almirant/shared";

// Schedule type enum (only meaningful when trigger = 'scheduled').
// 'once' (community issue #91) is a one-shot schedule: it fires exactly once
// at scheduleConfig.runAt and the dispatcher auto-disables the config
// (enabled=false) immediately after that single successful dispatch — see
// `updateScheduledAgentConfigLastRunAt` in scheduled-agent-config-repository.ts.
export const scheduleTypeEnum = pgEnum("schedule_type", [
  "manual",
  "time_window",
  "cron",
  "once",
]);

// Agent trigger discriminator: how the agent gets kicked off.
// 'scheduled' uses scheduleType + scheduleConfig; 'webhook' uses webhookToken.
export const agentTriggerEnum = pgEnum("agent_trigger", [
  "scheduled",
  "webhook",
]);

// Ownership discriminator for the dev-flow feature (issue #230): 'user' is a
// normal hand-created config (the default, preserving every existing row's
// behavior); 'system' marks a config provisioned by
// `provisionDevFlowForProject` for one of the four catalog built-in
// automations (see `@almirant/shared`'s builtin-automations.ts). System
// configs are not user-editable/deletable through the generic scheduled-agent
// routes/MCP tools — see `scheduled-agent-access.ts`'s
// `assertScheduledAgentConfigIsUserManaged`.
export const scheduledAgentConfigManagedByEnum = pgEnum(
  "scheduled_agent_config_managed_by",
  ["user", "system"],
);

// TypeScript interfaces for JSONB columns
export interface TimeWindowConfig {
  startHour: number;
  endHour: number;
  daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, etc.
}

export interface CronConfig {
  expression: string; // Cron expression
}

// One-shot schedule (scheduleType='once'): fires exactly once at `runAt`
// (ISO-8601 timestamp) and the dispatcher auto-disables the config right
// after that single dispatch. A past `runAt` is allowed at create/update
// time — it simply dispatches on the next tick instead of being rejected.
export interface OnceScheduleConfig {
  runAt: string; // ISO-8601 timestamp
}

export type ScheduleConfig = TimeWindowConfig | CronConfig | OnceScheduleConfig;

export interface TargetConfig {
  // Optional project scope for built-in automations. Empty/undefined means workspace-wide.
  projectIds?: string[];
  // Column-based targeting (e.g., Backlog drain or In Progress corrective work)
  columnIds?: string[];
  // Status-based targeting (e.g., items with certain statuses)
  statuses?: string[];
  // Priority filter
  priorities?: string[];
  // Max age in hours for items to process
  maxAgeHours?: number;
  // Custom filters
  customFilters?: Record<string, unknown>;
  // Validation gate: only pick review items that passed Definition of Done review.
  requireDodApproved?: boolean;
  // Deterministic scheduler mode: drain Backlog by project rules, exclusions, dependencies, and concurrency.
  backlogDrain?: BacklogDrainConfig;
  // Deterministic scheduler mode: repair Backlog items that failed Definition of Done review.
  dodRemediation?: BacklogDrainConfig;
  // Deterministic scheduler mode: enqueue read-only Definition of Done review jobs for review-column tasks.
  dodReview?: {
    enabled?: boolean;
    minAgeMinutes?: number;
    defaultMaxConcurrentJobs?: number | null;
    projects?: BacklogDrainConfig["projects"];
  };
  // Deterministic scheduler mode: batch validating tasks into the active release integration PR.
  releaseIntegration?: {
    enabled?: boolean;
    minAgeMinutes?: number;
    defaultMaxConcurrentJobs?: number | null;
    projects?: BacklogDrainConfig["projects"];
  };
}

// Scheduled agent configs table
export const scheduledAgentConfigs = pgTable(
  "scheduled_agent_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // Immutable ownership: set once at creation to the authenticated actor's
    // user id (MCP tool or REST route). Nullable for backward compatibility
    // with legacy configs created before ownership existed — a null owner
    // means "accessible to any workspace member", matching the previous
    // (ownerless) access model. See scheduled-agent-access.ts.
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    name: varchar("name", { length: 255 }).notNull(),
    prompt: text("prompt"),
    jobType: agentJobTypeEnum("job_type").notNull(),
    provider: agentProviderEnum("provider").notNull(),
    description: text("description"),
    codingAgent: varchar("coding_agent", { length: 100 }).default("claude-code"),
    aiProvider: varchar("ai_provider", { length: 100 }),
    aiModel: varchar("ai_model", { length: 100 }),
    reasoningLevel: varchar("reasoning_level", { length: 50 }),
    skillId: uuid("skill_id").references(() => skills.id, { onDelete: "set null" }),
    trigger: agentTriggerEnum("trigger").notNull().default("scheduled"),
    webhookToken: varchar("webhook_token", { length: 64 }),
    scheduleType: scheduleTypeEnum("schedule_type").notNull(),
    scheduleConfig: jsonb("schedule_config").$type<ScheduleConfig | null>(),
    timezone: varchar("timezone", { length: 100 }).notNull().default("Europe/Madrid"),
    enabled: boolean("enabled").notNull().default(false),
    targetConfig: jsonb("target_config").$type<TargetConfig>().notNull().default({}),
    mcpServers: jsonb("mcp_servers").$type<RunnerCustomMcpServersConfig | null>(),
    maxJobsPerRun: integer("max_jobs_per_run").notNull().default(10),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    // dev-flow (issue #230): see scheduledAgentConfigManagedByEnum above.
    managedBy: scheduledAgentConfigManagedByEnum("managed_by").notNull().default("user"),
    // Kebab-case id from @almirant/shared's BUILTIN_AUTOMATIONS catalog
    // (e.g. "backlog-drain"). No FK — the catalog is a static in-code list,
    // not a table; validated against BUILTIN_AUTOMATION_IDS at the service
    // layer (dev-flow-provisioning.ts). Only meaningful when managedBy is
    // 'system'.
    builtinAutomationId: text("builtin_automation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("scheduled_agent_configs_workspace_id_idx").on(table.workspaceId),
    index("scheduled_agent_configs_owner_user_id_idx").on(table.ownerUserId),
    index("scheduled_agent_configs_enabled_idx").on(table.enabled),
    index("scheduled_agent_configs_project_id_idx").on(table.projectId),
    index("scheduled_agent_configs_skill_id_idx").on(table.skillId),
    index("scheduled_agent_configs_trigger_idx").on(table.trigger),
    uniqueIndex("scheduled_agent_configs_webhook_token_idx").on(table.webhookToken),
    // dev-flow provisioning identity (issue #230): at most one system-managed
    // config per (project, built-in automation) — see
    // dev-flow-provisioning.ts's upsert-by-identity + duplicate-violation
    // retry, mirroring migration 0222's partial-unique-index + typed-error
    // pattern for concurrent dispatch authorities.
    uniqueIndex("scheduled_agent_configs_system_builtin_automation_uidx")
      .on(table.projectId, table.builtinAutomationId)
      .where(
        sql`${table.managedBy} = 'system' AND ${table.builtinAutomationId} IS NOT NULL`,
      ),
  ]
);

// Type exports
export type ScheduledAgentConfigDb = typeof scheduledAgentConfigs.$inferSelect;
export type NewScheduledAgentConfig = typeof scheduledAgentConfigs.$inferInsert;
