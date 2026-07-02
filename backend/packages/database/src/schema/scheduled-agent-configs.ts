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
import { agentJobTypeEnum, agentProviderEnum } from "./enums";
import { workspace } from "./workspace";
import { projects } from "./projects";
import { skills } from "./skills";
import type { BacklogDrainConfig } from "../repositories/agents/backlog-drain-selection";
import type { RunnerCustomMcpServersConfig } from "@almirant/shared";

// Schedule type enum (only meaningful when trigger = 'scheduled')
export const scheduleTypeEnum = pgEnum("schedule_type", [
  "manual",
  "time_window",
  "cron",
]);

// Agent trigger discriminator: how the agent gets kicked off.
// 'scheduled' uses scheduleType + scheduleConfig; 'webhook' uses webhookToken.
export const agentTriggerEnum = pgEnum("agent_trigger", [
  "scheduled",
  "webhook",
]);

// TypeScript interfaces for JSONB columns
export interface TimeWindowConfig {
  startHour: number;
  endHour: number;
  daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, etc.
}

export interface CronConfig {
  expression: string; // Cron expression
}

export type ScheduleConfig = TimeWindowConfig | CronConfig;

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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("scheduled_agent_configs_workspace_id_idx").on(table.workspaceId),
    index("scheduled_agent_configs_enabled_idx").on(table.enabled),
    index("scheduled_agent_configs_project_id_idx").on(table.projectId),
    index("scheduled_agent_configs_skill_id_idx").on(table.skillId),
    index("scheduled_agent_configs_trigger_idx").on(table.trigger),
    uniqueIndex("scheduled_agent_configs_webhook_token_idx").on(table.webhookToken),
  ]
);

// Type exports
export type ScheduledAgentConfigDb = typeof scheduledAgentConfigs.$inferSelect;
export type NewScheduledAgentConfig = typeof scheduledAgentConfigs.$inferInsert;
