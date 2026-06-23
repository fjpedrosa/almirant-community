import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { pgEnum } from "drizzle-orm/pg-core";

export const healthServiceEnum = pgEnum("health_service", ["api", "database", "vps"]);
export const healthStatusEnum = pgEnum("health_status", ["healthy", "degraded", "down"]);

export const healthCheckRecords = pgTable("health_check_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  serviceName: healthServiceEnum("service_name").notNull(),
  status: healthStatusEnum("status").notNull(),
  latencyMs: integer("latency_ms").notNull().default(0),
  message: text("message"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("health_check_service_checked_idx").on(table.serviceName, table.checkedAt),
]);

export type HealthCheckRecord = typeof healthCheckRecords.$inferSelect;
export type NewHealthCheckRecord = typeof healthCheckRecords.$inferInsert;
