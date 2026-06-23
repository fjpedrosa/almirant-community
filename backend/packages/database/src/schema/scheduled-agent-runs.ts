import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { scheduledAgentConfigs } from "./scheduled-agent-configs";
import { organization } from "./organization";

// Scheduled agent runs table - tracks individual executions of scheduled agents
export const scheduledAgentRuns = pgTable(
  "scheduled_agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    configId: uuid("config_id")
      .notNull()
      .references(() => scheduledAgentConfigs.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    itemsProcessed: integer("items_processed").notNull().default(0),
    itemsSucceeded: integer("items_succeeded").notNull().default(0),
    itemsFailed: integer("items_failed").notNull().default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("scheduled_agent_runs_config_started_idx").on(table.configId, table.startedAt),
    index("scheduled_agent_runs_status_idx").on(table.status),
    index("scheduled_agent_runs_organization_id_idx").on(table.organizationId),
  ]
);

// Type exports
export type ScheduledAgentRunDb = typeof scheduledAgentRuns.$inferSelect;
export type NewScheduledAgentRun = typeof scheduledAgentRuns.$inferInsert;
