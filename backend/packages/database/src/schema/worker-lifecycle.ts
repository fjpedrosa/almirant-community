import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { workerLifecycleEventTypeEnum } from "./enums";

export interface WorkerLifecycleMetadata {
  previousIp?: string;
  reason?: string;
  [key: string]: unknown;
}

export const workerLifecycleEvents = pgTable(
  "worker_lifecycle_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workerName: text("worker_name").notNull(),
    eventType: workerLifecycleEventTypeEnum("event_type").notNull(),
    ip: text("ip"),
    metadata: jsonb("metadata").default({}).$type<WorkerLifecycleMetadata>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("worker_lifecycle_events_worker_name_idx").on(table.workerName),
    index("worker_lifecycle_events_event_type_idx").on(table.eventType),
    index("worker_lifecycle_events_created_at_idx").on(table.createdAt),
  ]
);

export type WorkerLifecycleEventDb = typeof workerLifecycleEvents.$inferSelect;
export type NewWorkerLifecycleEvent = typeof workerLifecycleEvents.$inferInsert;
