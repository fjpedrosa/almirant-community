import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  numeric,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { agentJobs } from "./agent-jobs";
import { agentObservations } from "./agent-observations";
import { memoryTelemetryEventEnum } from "./enums";

export const agentMemoryTelemetry = pgTable(
  "agent_memory_telemetry",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentJobId: uuid("agent_job_id").references(() => agentJobs.id, {
      onDelete: "cascade",
    }),
    event: memoryTelemetryEventEnum("event").notNull(),
    query: text("query"),
    resultCount: integer("result_count"),
    durationMs: integer("duration_ms"),
    tokensInjected: integer("tokens_injected"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_memory_telemetry_org_idx").on(table.organizationId),
    index("agent_memory_telemetry_job_idx").on(table.agentJobId),
    index("agent_memory_telemetry_event_idx").on(table.event),
    index("agent_memory_telemetry_created_at_idx").on(table.createdAt),
  ]
);

export const agentMemoryTelemetryHits = pgTable(
  "agent_memory_telemetry_hits",
  {
    telemetryId: uuid("telemetry_id")
      .notNull()
      .references(() => agentMemoryTelemetry.id, { onDelete: "cascade" }),
    observationId: uuid("observation_id")
      .notNull()
      .references(() => agentObservations.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    score: numeric("score", { precision: 6, scale: 4 }),
    injected: boolean("injected").notNull().default(false),
  },
  (table) => [
    primaryKey({
      columns: [table.telemetryId, table.observationId],
      name: "agent_memory_telemetry_hits_pk",
    }),
    index("agent_memory_telemetry_hits_observation_idx").on(table.observationId),
    index("agent_memory_telemetry_hits_injected_idx").on(table.injected),
  ]
);

export type AgentMemoryTelemetry = typeof agentMemoryTelemetry.$inferSelect;
export type NewAgentMemoryTelemetry = typeof agentMemoryTelemetry.$inferInsert;
export type AgentMemoryTelemetryHit = typeof agentMemoryTelemetryHits.$inferSelect;
export type NewAgentMemoryTelemetryHit =
  typeof agentMemoryTelemetryHits.$inferInsert;
