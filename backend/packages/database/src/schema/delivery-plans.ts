import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { boards } from "./boards";
import { planReviewAdmissions } from "./plan-review-admissions";
import { planningSessions } from "./planning-sessions";
import { projects } from "./projects";
import { workItems } from "./work-items";
import { workspace } from "./workspace";

const digestCheck = (column: { name: string }) =>
  sql`${column} ~ '^[a-f0-9]{64}$'`;

export const deliveryPlans = pgTable("delivery_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspace.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
  planningSessionId: uuid("planning_session_id").references(() => planningSessions.id, { onDelete: "set null" }),
  creationKey: varchar("creation_key", { length: 255 }).notNull(),
  creationRequestSha256: char("creation_request_sha256", { length: 64 }).notNull(),
  currentRevisionNumber: integer("current_revision_number").default(0).notNull(),
  lockVersion: bigint("lock_version", { mode: "number" }).default(0).notNull(),
  createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("delivery_plans_workspace_creation_key_uidx").on(table.workspaceId, table.creationKey),
  uniqueIndex("delivery_plans_planning_session_uidx").on(table.planningSessionId).where(sql`${table.planningSessionId} IS NOT NULL`),
  index("delivery_plans_workspace_project_created_idx").on(table.workspaceId, table.projectId, table.createdAt),
  check("delivery_plans_creation_sha256_check", digestCheck(table.creationRequestSha256)),
  check("delivery_plans_revision_lock_check", sql`${table.currentRevisionNumber} >= 0 AND ${table.lockVersion} >= 0`),
]);

export const deliveryPlanRevisions = pgTable("delivery_plan_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: uuid("plan_id").notNull().references(() => deliveryPlans.id, { onDelete: "cascade" }),
  revisionNumber: integer("revision_number").notNull(),
  contractVersion: integer("contract_version").notNull(),
  contentSha256: char("content_sha256", { length: 64 }).notNull(),
  contentJson: jsonb("content_json").notNull(),
  sourcePlanReviewAdmissionId: uuid("source_plan_review_admission_id").references(() => planReviewAdmissions.id, { onDelete: "set null" }),
  acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("delivery_plan_revisions_plan_number_uidx").on(table.planId, table.revisionNumber),
  unique("delivery_plan_revisions_plan_id_id_unique").on(table.planId, table.id),
  uniqueIndex("delivery_plan_revisions_source_admission_uidx").on(table.sourcePlanReviewAdmissionId).where(sql`${table.sourcePlanReviewAdmissionId} IS NOT NULL`),
  check("delivery_plan_revisions_number_check", sql`${table.revisionNumber} > 0`),
  check("delivery_plan_revisions_contract_check", sql`${table.contractVersion} = 1`),
  check("delivery_plan_revisions_sha256_check", digestCheck(table.contentSha256)),
]);

export const deliveryPlanItems = pgTable("delivery_plan_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: uuid("plan_id").notNull().references(() => deliveryPlans.id, { onDelete: "cascade" }),
  stableKey: varchar("stable_key", { length: 255 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("delivery_plan_items_plan_stable_key_uidx").on(table.planId, table.stableKey),
  unique("delivery_plan_items_id_kind_unique").on(table.id, table.kind),
  uniqueIndex("delivery_plan_items_work_item_uidx").on(table.workItemId).where(sql`${table.workItemId} IS NOT NULL`),
  check("delivery_plan_items_projection_check", sql`(${table.kind} = 'feature' AND ${table.workItemId} IS NULL) OR (${table.kind} = 'work_unit' AND ${table.workItemId} IS NOT NULL)`),
]);

export const deliveryPlanRevisionItems = pgTable("delivery_plan_revision_items", {
  planRevisionId: uuid("plan_revision_id").notNull().references(() => deliveryPlanRevisions.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  parentFeatureItemId: uuid("parent_feature_item_id"),
  itemOrder: integer("item_order").notNull(),
  itemSha256: char("item_sha256", { length: 64 }).notNull(),
  itemJson: jsonb("item_json").notNull(),
}, (table) => [
  primaryKey({ columns: [table.planRevisionId, table.itemId] }),
  foreignKey({ columns: [table.itemId, table.kind], foreignColumns: [deliveryPlanItems.id, deliveryPlanItems.kind], name: "delivery_plan_revision_items_item_kind_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.planRevisionId, table.parentFeatureItemId], foreignColumns: [table.planRevisionId, table.itemId], name: "delivery_plan_revision_items_parent_revision_fk" }).onDelete("cascade"),
  index("delivery_plan_revision_items_item_idx").on(table.itemId),
  index("delivery_plan_revision_items_parent_idx").on(table.planRevisionId, table.parentFeatureItemId),
  check("delivery_plan_revision_items_parent_check", sql`${table.parentFeatureItemId} IS NULL OR (${table.kind} = 'work_unit' AND ${table.parentFeatureItemId} <> ${table.itemId})`),
  check("delivery_plan_revision_items_order_check", sql`${table.itemOrder} >= 0`),
  check("delivery_plan_revision_items_sha256_check", digestCheck(table.itemSha256)),
]);

export const deliveryPlanRevisionDependencies = pgTable("delivery_plan_revision_dependencies", {
  planRevisionId: uuid("plan_revision_id").notNull(),
  workUnitItemId: uuid("work_unit_item_id").notNull(),
  blockedByWorkUnitItemId: uuid("blocked_by_work_unit_item_id").notNull(),
  dependencyOrder: integer("dependency_order").notNull(),
}, (table) => [
  primaryKey({ columns: [table.planRevisionId, table.workUnitItemId, table.blockedByWorkUnitItemId] }),
  foreignKey({ columns: [table.planRevisionId, table.workUnitItemId], foreignColumns: [deliveryPlanRevisionItems.planRevisionId, deliveryPlanRevisionItems.itemId], name: "delivery_plan_revision_dependencies_work_unit_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.planRevisionId, table.blockedByWorkUnitItemId], foreignColumns: [deliveryPlanRevisionItems.planRevisionId, deliveryPlanRevisionItems.itemId], name: "delivery_plan_revision_dependencies_blocked_by_fk" }).onDelete("cascade"),
  index("delivery_plan_revision_dependencies_blocked_by_idx").on(table.planRevisionId, table.blockedByWorkUnitItemId),
  check("delivery_plan_revision_dependencies_order_check", sql`${table.dependencyOrder} >= 0`),
  check("delivery_plan_revision_dependencies_self_check", sql`${table.workUnitItemId} <> ${table.blockedByWorkUnitItemId}`),
]);

export type DeliveryPlan = typeof deliveryPlans.$inferSelect;
export type NewDeliveryPlan = typeof deliveryPlans.$inferInsert;
export type DeliveryPlanRevision = typeof deliveryPlanRevisions.$inferSelect;
export type NewDeliveryPlanRevision = typeof deliveryPlanRevisions.$inferInsert;
export type DeliveryPlanItem = typeof deliveryPlanItems.$inferSelect;
export type NewDeliveryPlanItem = typeof deliveryPlanItems.$inferInsert;
export type DeliveryPlanRevisionItem = typeof deliveryPlanRevisionItems.$inferSelect;
export type NewDeliveryPlanRevisionItem = typeof deliveryPlanRevisionItems.$inferInsert;
export type DeliveryPlanRevisionDependency = typeof deliveryPlanRevisionDependencies.$inferSelect;
export type NewDeliveryPlanRevisionDependency = typeof deliveryPlanRevisionDependencies.$inferInsert;
