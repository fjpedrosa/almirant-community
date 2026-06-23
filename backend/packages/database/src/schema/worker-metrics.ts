import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  numeric,
} from "drizzle-orm/pg-core";

export const workerMetricsHistory = pgTable(
  "worker_metrics_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workerId: text("worker_id").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    cpuPercent: numeric("cpu_percent"),
    ramPercent: numeric("ram_percent"),
    ramUsedMb: integer("ram_used_mb"),
    ramTotalMb: integer("ram_total_mb"),
    activeJobs: integer("active_jobs"),
    containerMetrics: jsonb("container_metrics"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("worker_metrics_worker_timestamp_idx").on(table.workerId, table.timestamp),
    index("worker_metrics_timestamp_idx").on(table.timestamp),
  ]
);

export type WorkerMetricsHistoryDb = typeof workerMetricsHistory.$inferSelect;
export type NewWorkerMetricsHistory = typeof workerMetricsHistory.$inferInsert;
