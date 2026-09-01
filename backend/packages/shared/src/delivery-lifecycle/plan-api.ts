import { z } from "zod";
import { parsePlanV1, type PlanV1 } from "./plan";

export const MAX_DELIVERY_PLAN_ACCEPTANCE_BYTES = 1_000_000;
const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const acceptanceRequest = z.object({ requestKey: z.string().min(1).max(255), plan: z.unknown() }).strict();
export const deliveryPlanAcceptanceResponseSchema = z.object({
  planId: uuid, revisionId: uuid, revisionNumber: z.literal(1), contentSha256: digest, responseSha256: digest, replayed: z.boolean(),
}).strict();
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
  success: z.literal(false),
  error: z.string().min(1).max(160),
  code: z.enum(["authentication_required", "acceptance_forbidden", "delivery_scope_not_found", "delivery_plan_not_found", "acceptance_unavailable", "delivery_plan_read_unavailable", "acceptance_idempotency_conflict", "acceptance_conflict", "invalid_delivery_plan_request"]),
}).strict();

export type DeliveryPlanAcceptanceRequest = { requestKey: string; plan: PlanV1 };
export type DeliveryPlanAcceptanceResponse = z.infer<typeof deliveryPlanAcceptanceResponseSchema>;
export type DeliveryPlanView = Omit<z.infer<typeof deliveryPlanViewSchema>, "plan"> & { plan: PlanV1 };
export type DeliveryPlanApiErrorCode = z.infer<typeof deliveryPlanApiErrorSchema>["code"];

export const parseDeliveryPlanAcceptanceRequest = (input: unknown): DeliveryPlanAcceptanceRequest => {
  const encoded = JSON.stringify(input);
  if (!encoded || new TextEncoder().encode(encoded).byteLength > MAX_DELIVERY_PLAN_ACCEPTANCE_BYTES) throw new Error("invalid_delivery_plan_request");
  const request = acceptanceRequest.parse(input);
  const plan = parsePlanV1(request.plan);
  uuid.parse(plan.target.projectId); uuid.parse(plan.target.boardId);
  return { requestKey: request.requestKey, plan };
};
export const parseDeliveryPlanView = (input: unknown): DeliveryPlanView => {
  const view = deliveryPlanViewSchema.parse(input);
  return { ...view, plan: parsePlanV1(view.plan) };
};
