import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { effortEstimationRequestStatusEnum } from "./enums";
import { workItems } from "./work-items";

/**
 * Internal queue of pending effort-estimation work (A-F-445).
 *
 * The partial unique index over (workItemId) WHERE status IN ('pending','processing')
 * makes enqueue operations idempotent: a second enqueue for the same work item
 * while a prior request is still pending/processing is a no-op at the DB level.
 */
export const effortEstimationRequests = pgTable(
  "effort_estimation_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    status: effortEstimationRequestStatusEnum("status")
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    requestedContentHash: varchar("requested_content_hash", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Dedup idempotente: solo un request activo por work item.
    uniqueIndex("effort_estimation_requests_active_unique_idx")
      .on(table.workItemId)
      .where(sql`status IN ('pending','processing')`),
    // Sweeper-friendly: encontrar peticiones pendientes por edad.
    index("effort_estimation_requests_pending_created_at_idx")
      .on(table.createdAt)
      .where(sql`status = 'pending'`),
    index("effort_estimation_requests_status_idx").on(table.status),
    index("effort_estimation_requests_work_item_id_idx").on(table.workItemId),
  ]
);

export type EffortEstimationRequest =
  typeof effortEstimationRequests.$inferSelect;
export type NewEffortEstimationRequest =
  typeof effortEstimationRequests.$inferInsert;
