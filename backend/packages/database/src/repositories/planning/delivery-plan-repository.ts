import { createHash, randomUUID } from "node:crypto";
import { canonicalizePlanV1, parseDeliveryPlanView, parsePlanV1, type DeliveryPlanView, type PlanV1 } from "@almirant/shared";
import { and, eq, sql } from "drizzle-orm";
import { db, type Database } from "../../client";
import {
  deliveryPlanAcceptanceReceipts,
  deliveryPlanItems,
  deliveryPlanRevisionDependencies,
  deliveryPlanRevisionItems,
  deliveryPlanRevisions,
  deliveryPlans,
  workItemDependencies,
  workItemEvents,
  workItems,
} from "../../schema";
import { assertNativePlanCompatibilityReady, type DeliveryCompatibilityExecutor } from "./delivery-compatibility-repository";

export type DeliveryPlanAcceptanceWriteGroup = "plan" | "work_units" | "items" | "dependencies" | "receipt" | "cas";
export type DeliveryPlanAcceptanceErrorCode =
  | "acceptance_unauthorized" | "acceptance_invalid_request_key" | "acceptance_invalid_plan"
  | "acceptance_scope_mismatch" | "acceptance_idempotency_conflict" | "acceptance_conflict";
export class DeliveryPlanAcceptanceError extends Error {
  constructor(public readonly code: DeliveryPlanAcceptanceErrorCode) { super(code); this.name = "DeliveryPlanAcceptanceError"; }
}
export interface FirstDeliveryPlanAcceptanceInput {
  workspaceId: string;
  projectId: string;
  boardId: string;
  userId: string;
  requestKey: string;
  plan: unknown;
}
export interface FirstDeliveryPlanAcceptanceResult {
  planId: string;
  revisionId: string;
  revisionNumber: 1;
  contentSha256: string;
  responseSha256: string;
  replayed: boolean;
}
interface AcceptanceOptions {
  database?: Database;
  failAfter?: (group: DeliveryPlanAcceptanceWriteGroup) => void | Promise<void>;
}

const rows = <T>(value: unknown): T[] => value as T[];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code: DeliveryPlanAcceptanceErrorCode): never => { throw new DeliveryPlanAcceptanceError(code); };
type ViewItem = DeliveryPlanView["items"][number];
type PlanRow = Omit<DeliveryPlanView, "items"> & { items: Array<Omit<ViewItem, "projection">> };
type Projection = NonNullable<ViewItem["projection"]>;

export const readDeliveryPlan = async (
  workspaceId: string,
  planId: string,
  executor: DeliveryCompatibilityExecutor = db,
): Promise<DeliveryPlanView | null> => {
  const [plan] = rows<PlanRow>(await executor.execute(sql`
    SELECT dp.id AS "planId", dp.project_id AS "projectId", dp.board_id AS "boardId", r.id AS "revisionId",
      r.revision_number AS "revisionNumber", r.content_sha256 AS "contentSha256", r.content_json AS plan,
      COALESCE(jsonb_agg(jsonb_build_object('itemId', dpi.id, 'stableKey', dpi.stable_key, 'kind', dpi.kind,
        'parentFeatureItemId', ri.parent_feature_item_id, 'workItemId', dpi.work_item_id) ORDER BY ri.item_order)
        FILTER (WHERE ri.item_id IS NOT NULL), '[]'::jsonb) AS items,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('workUnitItemId', d.work_unit_item_id,
        'blockedByWorkUnitItemId', d.blocked_by_work_unit_item_id, 'dependencyOrder', d.dependency_order) ORDER BY d.dependency_order)
        FROM delivery_plan_revision_dependencies d WHERE d.plan_revision_id = r.id), '[]'::jsonb) AS dependencies
    FROM delivery_plans dp JOIN delivery_plan_revisions r ON r.plan_id = dp.id AND r.revision_number = dp.current_revision_number
    LEFT JOIN delivery_plan_revision_items ri ON ri.plan_revision_id = r.id LEFT JOIN delivery_plan_items dpi ON dpi.id = ri.item_id
    WHERE dp.id = ${planId}::uuid AND dp.workspace_id = ${workspaceId}
    GROUP BY dp.id, r.id`));
  if (!plan) return null;
  const workItemIds = plan.items.flatMap((item) => item.workItemId ? [item.workItemId] : []);
  const projections = workItemIds.length ? rows<Projection>(await executor.execute(sql`
    SELECT id AS "workItemId", board_column_id AS "boardColumnId", work_unit_size AS size, backlog_intent AS "backlogIntent"
    FROM work_items WHERE id IN (${sql.join(workItemIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND project_id = ${plan.projectId}::uuid AND board_id = ${plan.boardId}::uuid`)) : [];
  const byId = new Map(projections.map((projection) => [projection.workItemId, projection]));
  return parseDeliveryPlanView({ ...plan, items: plan.items.map((item) => ({ ...item, projection: item.workItemId ? byId.get(item.workItemId) ?? null : null })) });
};

export const acceptFirstDeliveryPlan = async (
  input: FirstDeliveryPlanAcceptanceInput,
  options: AcceptanceOptions = {},
): Promise<FirstDeliveryPlanAcceptanceResult> => {
  if (typeof input.requestKey !== "string" || input.requestKey.length < 1 || input.requestKey.length > 255) fail("acceptance_invalid_request_key");
  let parsed: { plan: PlanV1; canonical: ReturnType<typeof canonicalizePlanV1> };
  try { const plan = parsePlanV1(input.plan); parsed = { plan, canonical: canonicalizePlanV1(plan) }; }
  catch { return fail("acceptance_invalid_plan"); }
  const { plan, canonical } = parsed;
  if (plan.target.projectId !== input.projectId || plan.target.boardId !== input.boardId) fail("acceptance_scope_mismatch");

  const database = options.database ?? db;
  try {
    return await database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([input.workspaceId, input.requestKey])}, 0))`);
      const [authorization] = rows<{ role: string }>(await tx.execute(sql`
        SELECT m.role FROM member m JOIN projects p ON p.id = ${input.projectId}::uuid AND p.workspace_id = m.workspace_id
        JOIN boards b ON b.id = ${input.boardId}::uuid AND b.workspace_id = m.workspace_id
        WHERE m.workspace_id = ${input.workspaceId} AND m.user_id = ${input.userId}
          AND m.role IN ('owner', 'admin', 'member') FOR SHARE OF m, p, b`));
      if (!authorization) fail("acceptance_unauthorized");
      const [existing] = rows<{ planId: string; requestSha256: string }>(await tx.execute(sql`
        SELECT id AS "planId", creation_request_sha256 AS "requestSha256" FROM delivery_plans
        WHERE workspace_id = ${input.workspaceId} AND creation_key = ${input.requestKey} FOR UPDATE`));
      if (existing) {
        if (existing.requestSha256 !== canonical.sha256) fail("acceptance_idempotency_conflict");
        const [receipt] = rows<Omit<FirstDeliveryPlanAcceptanceResult, "planId" | "replayed">>(await tx.execute(sql`
          SELECT r.revision_id AS "revisionId", revision_number AS "revisionNumber",
            content_sha256 AS "contentSha256", response_sha256 AS "responseSha256"
          FROM delivery_plan_acceptance_receipts r JOIN delivery_plan_revisions v ON v.id = r.revision_id
          WHERE r.plan_id = ${existing.planId}::uuid AND r.idempotency_key = ${input.requestKey}`));
        if (!receipt) return fail("acceptance_conflict");
        return {
          planId: existing.planId, revisionId: receipt.revisionId, revisionNumber: 1,
          contentSha256: receipt.contentSha256, responseSha256: receipt.responseSha256, replayed: true,
        };
      }

      const planId = randomUUID();
      const revisionId = randomUUID();
      const featureItems = plan.features.map((feature, order) => ({ feature, order, itemId: randomUUID() }));
      const featureIds = new Map(featureItems.map(({ feature, itemId }) => [feature.tempId, itemId]));
      const units = [
        ...plan.features.flatMap((feature) => feature.workUnits.map((unit) => ({ unit, parentItemId: featureIds.get(feature.tempId)! }))),
        ...plan.workUnits.map((unit) => ({ unit, parentItemId: null })),
      ].map((value, order) => ({ ...value, order: order + featureItems.length, itemId: randomUUID(), workItemId: randomUUID() }));
      const unitByKey = new Map(units.map((unit) => [unit.unit.tempId, unit]));
      for (const stableKey of units.map(({ unit }) => unit.tempId).sort()) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([input.workspaceId, input.requestKey, stableKey])}, 0))`);
      }
      const backlog = rows<{ id: string }>(await tx.execute(sql`
        SELECT id FROM board_columns WHERE board_id = ${input.boardId}::uuid AND role = 'backlog' AND name = 'Backlog' ORDER BY id FOR UPDATE`));
      await assertNativePlanCompatibilityReady(input, tx);
      if (backlog.length !== 1) fail("acceptance_conflict");

      await tx.insert(deliveryPlans).values({
        id: planId, workspaceId: input.workspaceId, projectId: input.projectId, boardId: input.boardId,
        creationKey: input.requestKey, creationRequestSha256: canonical.sha256, createdByUserId: input.userId,
      });
      await options.failAfter?.("plan");
      await tx.insert(workItems).values(units.map(({ unit, workItemId, order }) => ({
        id: workItemId, projectId: input.projectId, boardId: input.boardId, boardColumnId: backlog[0]!.id,
        parentId: null, type: "task" as const, title: unit.title, description: unit.description, priority: unit.priority,
        position: order, workUnitSize: unit.work_unit_size, workUnitSizeOrigin: "plan", backlogIntent: "new",
        createdByUserId: input.userId, requestedByUserId: input.userId,
      })));
      await options.failAfter?.("work_units");
      await tx.insert(deliveryPlanRevisions).values({
        id: revisionId, planId, revisionNumber: 1, contractVersion: 1, contentSha256: canonical.sha256,
        contentJson: JSON.parse(canonical.content), acceptedByUserId: input.userId, acceptedAt: new Date(),
      });
      await tx.insert(deliveryPlanItems).values([
        ...featureItems.map(({ feature, itemId }) => ({ id: itemId, planId, stableKey: feature.tempId, kind: "feature", workItemId: null })),
        ...units.map(({ unit, itemId, workItemId }) => ({ id: itemId, planId, stableKey: unit.tempId, kind: "work_unit", workItemId })),
      ]);
      await tx.insert(deliveryPlanRevisionItems).values([
        ...featureItems.map(({ feature, itemId, order }) => {
          const { workUnits: _, ...itemJson } = feature;
          return { planRevisionId: revisionId, itemId, kind: "feature", parentFeatureItemId: null, itemOrder: order, itemSha256: digest(itemJson), itemJson };
        }),
        ...units.map(({ unit, itemId, parentItemId, order }) => ({ planRevisionId: revisionId, itemId, kind: "work_unit", parentFeatureItemId: parentItemId, itemOrder: order, itemSha256: digest(unit), itemJson: unit })),
      ]);
      await options.failAfter?.("items");
      const dependencies = units.flatMap(({ unit, itemId, workItemId }) => unit.dependencies.map((blockedBy, dependencyOrder) => ({
        planRevisionId: revisionId, workUnitItemId: itemId, blockedByWorkUnitItemId: unitByKey.get(blockedBy)!.itemId,
        dependencyOrder, workItemId, blockedByWorkItemId: unitByKey.get(blockedBy)!.workItemId,
      })));
      if (dependencies.length) {
        await tx.insert(deliveryPlanRevisionDependencies).values(dependencies.map(({ workItemId: _, blockedByWorkItemId: __, ...value }) => value));
        await tx.insert(workItemDependencies).values(dependencies.map(({ workItemId, blockedByWorkItemId }) => ({ workItemId, blockedByWorkItemId })));
      }
      await tx.insert(workItemEvents).values(units.map(({ unit, workItemId, itemId }) => ({
        workItemId, eventType: "created" as const, triggeredBy: "user" as const, triggeredByUserId: input.userId,
        metadata: { title: unit.title, type: "task", boardId: input.boardId, boardColumnId: backlog[0]!.id, deliveryPlanId: planId, deliveryPlanItemId: itemId },
      })));
      await options.failAfter?.("dependencies");
      const response = { planId, revisionId, revisionNumber: 1 as const, contentSha256: canonical.sha256 };
      const responseSha256 = digest(response);
      await tx.insert(deliveryPlanAcceptanceReceipts).values({ planId, idempotencyKey: input.requestKey, requestSha256: canonical.sha256, revisionId, responseSha256 });
      await options.failAfter?.("receipt");
      const updated = await tx.update(deliveryPlans).set({ currentRevisionNumber: 1, lockVersion: 1, updatedAt: new Date() })
        .where(and(eq(deliveryPlans.id, planId), eq(deliveryPlans.currentRevisionNumber, 0), eq(deliveryPlans.lockVersion, 0))).returning({ id: deliveryPlans.id });
      if (updated.length !== 1) fail("acceptance_conflict");
      await options.failAfter?.("cas");
      return { ...response, responseSha256, replayed: false };
    });
  } catch (error) {
    if (error instanceof DeliveryPlanAcceptanceError || (error as { code?: string }).code !== "23505") throw error;
    return fail("acceptance_conflict");
  }
};
