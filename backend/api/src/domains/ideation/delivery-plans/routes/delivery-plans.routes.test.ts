import { describe, expect, it } from "bun:test";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/almirant_unit_tests";

const { Elysia } = await import("elysia");
const { DeliveryPlanAcceptanceError, readDeliveryPlan } = await import("@almirant/database");
const { MAX_DELIVERY_PLAN_ACCEPTANCE_BYTES } = await import("@almirant/shared");
const { DeliveryPlanAcceptanceGateError } = await import("../services/delivery-plan-acceptance-gate");
const { createDeliveryPlansRoutes } = await import("./delivery-plans.routes");

const projectId = "10000000-0000-4000-8000-000000000001";
const boardId = "20000000-0000-4000-8000-000000000002";
const planId = "30000000-0000-4000-8000-000000000003";
const revisionId = "40000000-0000-4000-8000-000000000004";
const workItemId = "50000000-0000-4000-8000-000000000005";
const unit = (tempId: string) => ({ kind: "work_unit" as const, tempId, title: tempId, priority: "medium" as const, work_unit_size: "M" as const, acceptance: ["done"], dependencies: [] });
const plans = [
  { version: 1 as const, kind: "plan" as const, title: "direct", target: { projectId, boardId }, features: [], workUnits: [unit("direct")] },
  { version: 1 as const, kind: "plan" as const, title: "featured", target: { projectId, boardId }, features: [{ kind: "feature" as const, tempId: "feature", title: "Feature", workUnits: [unit("featured")] }], workUnits: [] },
  { version: 1 as const, kind: "plan" as const, title: "mixed", target: { projectId, boardId }, features: [{ kind: "feature" as const, tempId: "feature", title: "Feature", workUnits: [unit("featured")] }], workUnits: [unit("direct")] },
];

const app = (overrides: Record<string, unknown> = {}, actor: unknown = { user: { id: "user-1" }, activeWorkspace: { id: "workspace-1" }, memberRole: "member" }) => new Elysia()
  .derive(() => actor as never)
  .use(createDeliveryPlansRoutes({
    authorize: async () => "allowed",
    gate: async () => {},
    accept: async () => ({ planId, revisionId, revisionNumber: 1, contentSha256: "a".repeat(64), responseSha256: "b".repeat(64), replayed: false }),
    read: async () => null,
    ...overrides,
  } as never));
const post = (body: unknown) => new Request("http://localhost/delivery-plans/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
type JsonBody = { code?: string; data?: { replayed?: boolean; planId?: string } };
const body = async (response: Response) => ({ status: response.status, json: await response.json() as JsonBody });

describe("delivery Plans routes", () => {
  it("accepts direct, featured, and mixed Plans and returns exact replay state", async () => {
    const seen: unknown[] = [];
    const route = app({ accept: async (input: unknown) => { seen.push(input); return { planId, revisionId, revisionNumber: 1, contentSha256: "a".repeat(64), responseSha256: "b".repeat(64), replayed: seen.length > 1 }; } });
    for (const [index, plan] of plans.entries()) {
      const response = await body(await route.handle(post({ requestKey: `request-${index}`, plan })));
      expect(response.status).toBe(200);
      expect(response.json.data?.replayed).toBe(index > 0);
    }
    expect(seen.map((value) => {
      const input = value as { workspaceId: string; userId: string; projectId: string; boardId: string };
      return [input.workspaceId, input.userId, input.projectId, input.boardId];
    })).toEqual(Array(3).fill(["workspace-1", "user-1", projectId, boardId]));
  });

  it("returns bounded auth, permission, gate, conflict, and validation errors without raw details", async () => {
    const cases: Array<[ReturnType<typeof app>, Request, number, string]> = [
      [app({}, { user: null, activeWorkspace: null, memberRole: null }), post({ requestKey: "key", plan: plans[0] }), 401, "authentication_required"],
      [app({ authorize: async () => "forbidden" }), post({ requestKey: "key", plan: plans[0] }), 403, "acceptance_forbidden"],
      [app({ authorize: async () => "not_found" }), post({ requestKey: "key", plan: plans[0] }), 404, "delivery_scope_not_found"],
      [app({ gate: async () => { throw new DeliveryPlanAcceptanceGateError(); } }), post({ requestKey: "key", plan: plans[0] }), 409, "acceptance_unavailable"],
      [app({ accept: async () => { throw new DeliveryPlanAcceptanceError("acceptance_idempotency_conflict"); } }), post({ requestKey: "key", plan: plans[0] }), 409, "acceptance_idempotency_conflict"],
      [app(), post({ requestKey: "key", plan: { ...plans[0], points: 3 } }), 422, "invalid_delivery_plan_request"],
      [app(), post({ requestKey: "key", plan: plans[0], authorized: true }), 422, "invalid_delivery_plan_request"],
      [app(), post({ requestKey: "key", plan: { ...plans[0], title: "x".repeat(MAX_DELIVERY_PLAN_ACCEPTANCE_BYTES) } }), 422, "invalid_delivery_plan_request"],
    ];
    for (const [route, request, status, code] of cases) {
      const response = await body(await route.handle(request));
      expect([response.status, response.json.code]).toEqual([status, code]);
      expect(JSON.stringify(response.json)).not.toContain("raw");
    }
  });

  it("reads one tenant-scoped Plan with one aggregate and one batched projection query", async () => {
    const calls: unknown[] = [];
    const executor = { execute: async (query: unknown) => {
      calls.push(query);
      if (calls.length === 1) return [{ planId, projectId, boardId, revisionId, revisionNumber: 1, contentSha256: "a".repeat(64), plan: plans[1], items: [
        { itemId: "60000000-0000-4000-8000-000000000006", stableKey: "feature", kind: "feature", parentFeatureItemId: null, workItemId: null },
        { itemId: "70000000-0000-4000-8000-000000000007", stableKey: "featured", kind: "work_unit", parentFeatureItemId: "60000000-0000-4000-8000-000000000006", workItemId },
      ], dependencies: [] }];
      return [{ workItemId, boardColumnId: "80000000-0000-4000-8000-000000000008", size: "M", backlogIntent: "new" }];
    } };
    const view = await readDeliveryPlan("workspace-1", planId, executor as never);
    expect(calls).toHaveLength(2);
    expect(view?.items.map((item) => [item.kind, item.projection?.workItemId ?? null])).toEqual([["feature", null], ["work_unit", workItemId]]);
    const response = await body(await app({ read: async () => view }).handle(new Request(`http://localhost/delivery-plans/${planId}`)));
    expect([response.status, response.json.data?.planId]).toEqual([200, planId]);
  });

  it("returns 404 for empty or cross-tenant reads and 422 for malformed IDs", async () => {
    let queryCount = 0;
    expect(await readDeliveryPlan("workspace-1", planId, { execute: async () => { queryCount += 1; return []; } })).toBeNull();
    expect(queryCount).toBe(1);
    for (const [id, status, code] of [[planId, 404, "delivery_plan_not_found"], ["not-a-uuid", 422, "invalid_delivery_plan_request"]] as const) {
      const response = await body(await app().handle(new Request(`http://localhost/delivery-plans/${id}`)));
      expect([response.status, response.json.code]).toEqual([status, code]);
    }
  });
});
