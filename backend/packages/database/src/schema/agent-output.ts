import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { agentJobs } from "./agent-jobs";
import { user } from "./auth";
import { scheduledAgentConfigs } from "./scheduled-agent-configs";
import { scheduledAgentRuns } from "./scheduled-agent-runs";
import { workspace } from "./workspace";

export type AgentOutputJsonSchema = Record<string, unknown>;
export type AgentOutputDeliveryStatus =
  | "pending"
  | "delivering"
  | "retry_wait"
  | "delivered"
  | "dead_letter";
export type AgentOutputSubmissionStatus = "submitted" | "terminal_error";

/**
 * Secret-free policy copied into a job at dispatch time.
 *
 * Endpoint configuration and credentials deliberately do not belong here:
 * runners and MCP clients can read the job config.
 */
export interface AgentOutputPolicySnapshot {
  sinkId: string;
  sinkVersion: number;
  required: boolean;
  schemaHash: string;
  schema: AgentOutputJsonSchema;
  maxPayloadBytes: number;
}

export const agentOutputSinks = pgTable(
  "agent_output_sinks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 255 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    endpointOrigin: text("endpoint_origin").notNull(),
    pathTemplate: text("path_template").notNull().default("/"),
    headerTemplates: jsonb("header_templates")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    payloadSchema: jsonb("payload_schema")
      .$type<AgentOutputJsonSchema>()
      .notNull(),
    schemaHash: varchar("schema_hash", { length: 64 }).notNull(),
    maxPayloadBytes: integer("max_payload_bytes").notNull().default(262_144),
    encryptedHeaders: text("encrypted_headers"),
    headersIv: varchar("headers_iv", { length: 64 }),
    headersAuthTag: varchar("headers_auth_tag", { length: 64 }),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_output_sinks_workspace_idx").on(table.workspaceId),
    check("agent_output_sinks_version_positive", sql`${table.version} > 0`),
    check(
      "agent_output_sinks_max_payload_bytes_positive",
      sql`${table.maxPayloadBytes} > 0`,
    ),
    check(
      "agent_output_sinks_max_payload_bytes_limit",
      sql`${table.maxPayloadBytes} <= 1048576`,
    ),
    check(
      "agent_output_sinks_schema_hash_check",
      sql`${table.schemaHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "agent_output_sinks_headers_encryption_check",
      sql`(
        (${table.encryptedHeaders} IS NULL AND ${table.headersIv} IS NULL AND ${table.headersAuthTag} IS NULL)
        OR
        (${table.encryptedHeaders} IS NOT NULL AND ${table.headersIv} IS NOT NULL AND ${table.headersAuthTag} IS NOT NULL)
      )`,
    ),
  ],
);

export const scheduledAgentOutputSinks = pgTable(
  "scheduled_agent_output_sinks",
  {
    configId: uuid("config_id")
      .primaryKey()
      .references(() => scheduledAgentConfigs.id, { onDelete: "cascade" }),
    sinkId: uuid("sink_id")
      .notNull()
      .references(() => agentOutputSinks.id, { onDelete: "restrict" }),
    sinkVersion: integer("sink_version").notNull(),
    required: boolean("required").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("scheduled_agent_output_sinks_config_uidx").on(table.configId),
    index("scheduled_agent_output_sinks_sink_idx").on(table.sinkId),
    check(
      "scheduled_agent_output_sinks_version_positive",
      sql`${table.sinkVersion} > 0`,
    ),
  ],
);

export const agentOutputBindings = pgTable(
  "agent_output_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => scheduledAgentRuns.id, { onDelete: "cascade" }),
    sinkId: uuid("sink_id")
      .notNull()
      .references(() => agentOutputSinks.id, { onDelete: "restrict" }),
    encryptedBinding: text("encrypted_binding").notNull(),
    bindingIv: varchar("binding_iv", { length: 64 }).notNull(),
    bindingAuthTag: varchar("binding_auth_tag", { length: 64 }).notNull(),
    bindingHash: varchar("binding_hash", { length: 64 }).notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_output_bindings_run_uidx").on(table.runId),
    index("agent_output_bindings_sink_idx").on(table.sinkId),
    check(
      "agent_output_bindings_hash_check",
      sql`${table.bindingHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "agent_output_bindings_key_version_positive",
      sql`${table.keyVersion} > 0`,
    ),
  ],
);

export const agentOutputSubmissions = pgTable(
  "agent_output_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => scheduledAgentRuns.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => agentJobs.id, { onDelete: "cascade" }),
    sinkId: uuid("sink_id")
      .notNull()
      .references(() => agentOutputSinks.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 32 })
      .$type<AgentOutputSubmissionStatus>()
      .notNull(),
    payload: jsonb("payload").$type<unknown>(),
    payloadHash: varchar("payload_hash", { length: 64 }),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: varchar("error_message", { length: 255 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_output_submissions_run_uidx").on(table.runId),
    uniqueIndex("agent_output_submissions_job_uidx").on(table.jobId),
    index("agent_output_submissions_sink_idx").on(table.sinkId),
    check(
      "agent_output_submissions_status_check",
      sql`${table.status} IN ('submitted', 'terminal_error')`,
    ),
    check(
      "agent_output_submissions_hash_check",
      sql`${table.payloadHash} IS NULL OR ${table.payloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "agent_output_submissions_shape_check",
      sql`(
        (${table.status} = 'submitted' AND ${table.payload} IS NOT NULL AND ${table.payloadHash} IS NOT NULL AND ${table.errorCode} IS NULL)
        OR
        (${table.status} = 'terminal_error' AND ${table.payload} IS NULL AND ${table.payloadHash} IS NULL AND ${table.errorCode} IS NOT NULL)
      )`,
    ),
  ],
);

export const agentOutputDeliveries = pgTable(
  "agent_output_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => agentOutputSubmissions.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 32 })
      .$type<AgentOutputDeliveryStatus>()
      .notNull()
      .default("pending"),
    stateVersion: integer("state_version").notNull().default(1),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    responseStatus: integer("response_status"),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_output_deliveries_submission_uidx").on(
      table.submissionId,
    ),
    uniqueIndex("agent_output_deliveries_idempotency_uidx").on(
      table.idempotencyKey,
    ),
    index("agent_output_deliveries_claim_idx").on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt,
    ),
    check(
      "agent_output_deliveries_status_check",
      sql`${table.status} IN ('pending', 'delivering', 'retry_wait', 'delivered', 'dead_letter')`,
    ),
    check(
      "agent_output_deliveries_attempts_nonnegative",
      sql`${table.attempts} >= 0`,
    ),
    check(
      "agent_output_deliveries_state_version_positive",
      sql`${table.stateVersion} > 0`,
    ),
  ],
);

export type AgentOutputSinkDb = typeof agentOutputSinks.$inferSelect;
export type NewAgentOutputSink = typeof agentOutputSinks.$inferInsert;
export type ScheduledAgentOutputSinkDb =
  typeof scheduledAgentOutputSinks.$inferSelect;
export type AgentOutputBindingDb = typeof agentOutputBindings.$inferSelect;
export type AgentOutputSubmissionDb = typeof agentOutputSubmissions.$inferSelect;
export type AgentOutputDeliveryDb = typeof agentOutputDeliveries.$inferSelect;
