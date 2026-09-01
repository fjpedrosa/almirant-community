import { Elysia, t } from "elysia";
import {
  acceptFirstDeliveryPlan, acceptRevisedDeliveryPlan, getBoardById, getProjectById, isProjectMember, readDeliveryPlan,
  DeliveryPlanAcceptanceError,
} from "@almirant/database";
import {
  deliveryPlanAcceptanceResponseSchema, deliveryPlanRevisionResponseSchema, deliveryPlanApiErrorSchema,
  parseDeliveryPlanAcceptanceRequest, parseDeliveryPlanRevisionRequest, parseDeliveryPlanView, type DeliveryPlanApiErrorCode, type DeliveryPlanView,
} from "@almirant/shared";
import { DeliveryPlanAcceptanceGateError, assertDeliveryPlanAcceptanceEnabled } from "../services/delivery-plan-acceptance-gate";

type Actor = { workspaceId: string; userId: string; memberRole: string | null };
type Scope = Actor & { projectId: string; boardId: string };
type Authorization = "allowed" | "forbidden" | "not_found";
type Dependencies = {
  authorize: (scope: Scope) => Promise<Authorization>;
  gate: (scope: Pick<Scope, "workspaceId" | "projectId" | "boardId">) => Promise<void>;
  accept: typeof acceptFirstDeliveryPlan;
  acceptRevision: typeof acceptRevisedDeliveryPlan;
  read: (workspaceId: string, planId: string) => Promise<DeliveryPlanView | null>;
};
type Set = { status?: number | string };
const messages: Record<DeliveryPlanApiErrorCode, string> = {
  authentication_required: "Authentication required", acceptance_forbidden: "Delivery Plan access denied",
  delivery_scope_not_found: "Delivery scope not found", delivery_plan_not_found: "Delivery Plan not found",
  acceptance_unavailable: "Delivery Plan acceptance is unavailable", delivery_plan_read_unavailable: "Delivery Plan read is unavailable",
  acceptance_idempotency_conflict: "Acceptance key conflicts with another Plan", acceptance_stale_revision: "Delivery Plan revision is stale",
  acceptance_projection_blocked: "Delivery Plan projection is blocked", acceptance_conflict: "Delivery Plan acceptance conflict", invalid_delivery_plan_request: "Invalid Delivery Plan request",
};
const failure = (set: Set, status: number, code: DeliveryPlanApiErrorCode) => {
  set.status = status;
  return deliveryPlanApiErrorSchema.parse({ success: false, error: messages[code], code });
};
const actor = (context: unknown): Actor | null => {
  const value = context as { user?: { id?: string } | null; activeWorkspace?: { id?: string } | null; memberRole?: string | null };
  return value.user?.id && value.activeWorkspace?.id ? { workspaceId: value.activeWorkspace.id, userId: value.user.id, memberRole: value.memberRole ?? null } : null;
};
const defaultAuthorize = async (scope: Scope): Promise<Authorization> => {
  const [project, board] = await Promise.all([getProjectById(scope.workspaceId, scope.projectId), getBoardById(scope.boardId, scope.workspaceId)]);
  if (!project || !board) return "not_found";
  if (scope.memberRole === "owner" || scope.memberRole === "admin") return "allowed";
  return await isProjectMember(scope.projectId, scope.userId) ? "allowed" : "forbidden";
};

const defaults: Dependencies = { authorize: defaultAuthorize, gate: assertDeliveryPlanAcceptanceEnabled, accept: acceptFirstDeliveryPlan, acceptRevision: acceptRevisedDeliveryPlan, read: readDeliveryPlan };
const validId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const createDeliveryPlansRoutes = (dependencies: Dependencies = defaults) => new Elysia({ prefix: "/delivery-plans" })
  .post("/accept", async (context) => {
    const current = actor(context);
    if (!current) return failure(context.set, 401, "authentication_required");
    let request;
    try { request = parseDeliveryPlanAcceptanceRequest(context.body); }
    catch { return failure(context.set, 422, "invalid_delivery_plan_request"); }
    const scope = { ...current, ...request.plan.target };
    try {
      const authorization = await dependencies.authorize(scope);
      if (authorization !== "allowed") return failure(context.set, authorization === "not_found" ? 404 : 403, authorization === "not_found" ? "delivery_scope_not_found" : "acceptance_forbidden");
      await dependencies.gate(scope);
      const result = await dependencies.accept({ ...request, workspaceId: scope.workspaceId, userId: scope.userId, projectId: scope.projectId, boardId: scope.boardId });
      return { success: true as const, data: deliveryPlanAcceptanceResponseSchema.parse(result) };
    } catch (error) {
      if (error instanceof DeliveryPlanAcceptanceGateError) return failure(context.set, 409, "acceptance_unavailable");
      if (error instanceof DeliveryPlanAcceptanceError) {
        if (error.code === "acceptance_unauthorized") return failure(context.set, 403, "acceptance_forbidden");
        if (error.code === "acceptance_idempotency_conflict") return failure(context.set, 409, error.code);
        if (error.code === "acceptance_conflict") return failure(context.set, 409, error.code);
        return failure(context.set, 422, "invalid_delivery_plan_request");
      }
      return failure(context.set, 409, "acceptance_unavailable");
    }
  }, { body: t.Unknown() })
  .post("/:planId/revisions", async (context) => {
    const current = actor(context);
    if (!current) return failure(context.set, 401, "authentication_required");
    if (!validId(context.params.planId)) return failure(context.set, 422, "invalid_delivery_plan_request");
    let request;
    try { request = parseDeliveryPlanRevisionRequest(context.body); }
    catch { return failure(context.set, 422, "invalid_delivery_plan_request"); }
    try {
      const stored = await dependencies.read(current.workspaceId, context.params.planId);
      if (!stored) return failure(context.set, 404, "delivery_plan_not_found");
      const authorization = await dependencies.authorize({ ...current, projectId: stored.projectId, boardId: stored.boardId });
      if (authorization !== "allowed") return failure(context.set, authorization === "not_found" ? 404 : 403, authorization === "not_found" ? "delivery_plan_not_found" : "acceptance_forbidden");
      await dependencies.gate({ workspaceId: current.workspaceId, projectId: stored.projectId, boardId: stored.boardId });
      const result = await dependencies.acceptRevision({ ...request, workspaceId: current.workspaceId, userId: current.userId, planId: context.params.planId });
      return { success: true as const, data: deliveryPlanRevisionResponseSchema.parse(result) };
    } catch (error) {
      if (error instanceof DeliveryPlanAcceptanceGateError) return failure(context.set, 409, "acceptance_unavailable");
      if (error instanceof DeliveryPlanAcceptanceError) {
        if (error.code === "acceptance_unauthorized") return failure(context.set, 403, "acceptance_forbidden");
        if (["acceptance_idempotency_conflict", "acceptance_stale_revision", "acceptance_projection_blocked", "acceptance_conflict"].includes(error.code)) return failure(context.set, 409, error.code as DeliveryPlanApiErrorCode);
        return failure(context.set, 422, "invalid_delivery_plan_request");
      }
      return failure(context.set, 409, "acceptance_unavailable");
    }
  }, { body: t.Unknown(), params: t.Object({ planId: t.String({ maxLength: 64 }) }) })
  .get("/:planId", async (context) => {
    const current = actor(context);
    if (!current) return failure(context.set, 401, "authentication_required");
    if (!validId(context.params.planId)) return failure(context.set, 422, "invalid_delivery_plan_request");
    try {
      const view = await dependencies.read(current.workspaceId, context.params.planId);
      if (!view) return failure(context.set, 404, "delivery_plan_not_found");
      const authorization = await dependencies.authorize({ ...current, projectId: view.projectId, boardId: view.boardId });
      if (authorization !== "allowed") return failure(context.set, authorization === "not_found" ? 404 : 403, authorization === "not_found" ? "delivery_plan_not_found" : "acceptance_forbidden");
      return { success: true as const, data: parseDeliveryPlanView(view) };
    } catch { return failure(context.set, 409, "delivery_plan_read_unavailable"); }
  }, { params: t.Object({ planId: t.String({ maxLength: 64 }) }) });

export const deliveryPlansRoutes = createDeliveryPlansRoutes();
