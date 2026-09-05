import { z } from "zod";
import { parsePlanV1, type PlanV1 } from "./plan";

export const MAX_DELIVERY_PLAN_ACCEPTANCE_BYTES = 1_000_000;
const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const requestKey = z.string().min(1).max(255);
const acceptanceRequest = z.object({ requestKey, plan: z.unknown() }).strict();
const revisionRequest = z.object({ requestKey, expectedCurrentRevisionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), plan: z.unknown() }).strict();
const response = { planId: uuid, revisionId: uuid, contentSha256: digest, responseSha256: digest, replayed: z.boolean() };
export const deliveryPlanAcceptanceResponseSchema = z.object({ ...response, revisionNumber: z.literal(1) }).strict();
export const deliveryPlanRevisionResponseSchema = z.object({ ...response, revisionNumber: z.number().int().positive(), outcome: z.enum(["created", "no_op"]) }).strict();
const projection = z.object({ workItemId: uuid, boardColumnId: uuid, size: z.enum(["XS", "S", "M", "L", "XL"]), backlogIntent: z.enum(["new", "fix"]) }).strict();
export const deliveryPlanViewSchema = z.object({
  planId: uuid, projectId: uuid, boardId: uuid, revisionId: uuid, revisionNumber: z.number().int().positive(), contentSha256: digest, plan: z.unknown(),
  items: z.array(z.object({ itemId: uuid, stableKey: z.string().min(1).max(255), kind: z.enum(["feature", "work_unit"]), parentFeatureItemId: uuid.nullable(), workItemId: uuid.nullable(), projection: projection.nullable() }).strict()).max(2_000),
  dependencies: z.array(z.object({ workUnitItemId: uuid, blockedByWorkUnitItemId: uuid, dependencyOrder: z.number().int().nonnegative() }).strict()).max(10_000),
}).strict().superRefine((view, context) => view.items.forEach((item, index) => {
  const valid = item.kind === "feature"
    ? item.workItemId === null && item.projection === null
    : item.workItemId !== null && item.projection?.workItemId === item.workItemId;
  if (!valid) context.addIssue({ code: "custom", path: ["items", index], message: "Invalid Plan item projection" });
}));
export const deliveryPlanApiErrorSchema = z.object({
  success: z.literal(false), error: z.string().min(1).max(160),
  code: z.enum(["authentication_required", "acceptance_forbidden", "delivery_scope_not_found", "delivery_plan_not_found", "acceptance_unavailable", "delivery_plan_read_unavailable", "acceptance_idempotency_conflict", "acceptance_stale_revision", "acceptance_projection_blocked", "acceptance_conflict", "invalid_delivery_plan_request"]),
}).strict();
export const deliveryPlanRevisionApiErrorSchema = deliveryPlanApiErrorSchema;

export type DeliveryPlanAcceptanceRequest = { requestKey: string; plan: PlanV1 };
export type DeliveryPlanRevisionRequest = { requestKey: string; expectedCurrentRevisionNumber: number; plan: PlanV1 };
export type DeliveryPlanAcceptanceResponse = z.infer<typeof deliveryPlanAcceptanceResponseSchema>;
export type DeliveryPlanRevisionResponse = z.infer<typeof deliveryPlanRevisionResponseSchema>;
export type DeliveryPlanView = Omit<z.infer<typeof deliveryPlanViewSchema>, "plan"> & { plan: PlanV1 };
export type DeliveryPlanApiErrorCode = z.infer<typeof deliveryPlanApiErrorSchema>["code"];
const bounded = (input: unknown) => { const encoded = JSON.stringify(input); if (!encoded || new TextEncoder().encode(encoded).byteLength > MAX_DELIVERY_PLAN_ACCEPTANCE_BYTES) throw new Error("invalid_delivery_plan_request"); };
const plan = (input: unknown) => { const value = parsePlanV1(input); uuid.parse(value.target.projectId); uuid.parse(value.target.boardId); return value; };
export const parseDeliveryPlanAcceptanceRequest = (input: unknown): DeliveryPlanAcceptanceRequest => { bounded(input); const request = acceptanceRequest.parse(input); return { requestKey: request.requestKey, plan: plan(request.plan) }; };
export const parseDeliveryPlanRevisionRequest = (input: unknown): DeliveryPlanRevisionRequest => { bounded(input); const request = revisionRequest.parse(input); return { ...request, plan: plan(request.plan) }; };
export const parseDeliveryPlanView = (input: unknown): DeliveryPlanView => {
  const view = deliveryPlanViewSchema.parse(input);
  return { ...view, plan: parsePlanV1(view.plan) };
};
