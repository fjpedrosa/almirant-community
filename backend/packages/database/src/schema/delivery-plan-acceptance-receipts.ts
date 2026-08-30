import { sql } from "drizzle-orm";
import { char, check, foreignKey, pgTable, primaryKey, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { deliveryPlans, deliveryPlanRevisions } from "./delivery-plans";

const digestCheck = (column: { name: string }) => sql`${column} ~ '^[a-f0-9]{64}$'`;

export const deliveryPlanAcceptanceReceipts = pgTable("delivery_plan_acceptance_receipts", {
  planId: uuid("plan_id").notNull().references(() => deliveryPlans.id, { onDelete: "cascade" }),
  idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
  requestSha256: char("request_sha256", { length: 64 }).notNull(),
  revisionId: uuid("revision_id").notNull(),
  responseSha256: char("response_sha256", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.planId, table.idempotencyKey] }),
  foreignKey({ columns: [table.planId, table.revisionId], foreignColumns: [deliveryPlanRevisions.planId, deliveryPlanRevisions.id], name: "delivery_plan_acceptance_receipts_plan_revision_fk" }).onDelete("restrict"),
  check("delivery_plan_acceptance_receipts_request_sha256_check", digestCheck(table.requestSha256)),
  check("delivery_plan_acceptance_receipts_response_sha256_check", digestCheck(table.responseSha256)),
]);

export type DeliveryPlanAcceptanceReceipt = typeof deliveryPlanAcceptanceReceipts.$inferSelect;
export type NewDeliveryPlanAcceptanceReceipt = typeof deliveryPlanAcceptanceReceipts.$inferInsert;
