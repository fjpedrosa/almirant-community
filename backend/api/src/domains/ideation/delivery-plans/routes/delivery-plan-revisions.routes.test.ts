import { describe, expect, it } from "bun:test";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/almirant_unit_tests";
const { Elysia } = await import("elysia");
const { DeliveryPlanAcceptanceError } = await import("@almirant/database");
const { MAX_DELIVERY_PLAN_ACCEPTANCE_BYTES, deliveryPlanAcceptanceResponseSchema, deliveryPlanRevisionApiErrorSchema, deliveryPlanRevisionResponseSchema, parseDeliveryPlanRevisionRequest } = await import("@almirant/shared");
const { DeliveryPlanAcceptanceGateError } = await import("../services/delivery-plan-acceptance-gate");
const { createDeliveryPlansRoutes } = await import("./delivery-plans.routes");
const projectId = "10000000-0000-4000-8000-000000000001", boardId = "20000000-0000-4000-8000-000000000002", planId = "30000000-0000-4000-8000-000000000003", revisionId = "40000000-0000-4000-8000-000000000004";
const unit = { kind: "work_unit" as const, tempId: "wu", title: "WU", priority: "medium" as const, work_unit_size: "M" as const, acceptance: ["done"], dependencies: [] };
const plan = { version: 1 as const, kind: "plan" as const, title: "Plan", target: { projectId, boardId }, features: [], workUnits: [unit] };
const payloadPlan = (count: number) => ({ ...plan, workUnits: Array.from({ length: count }, (_, index) => ({ ...unit, tempId: `wu-${index}`, description: "x".repeat(20_000) })) });
const view = { planId, projectId, boardId, revisionId, revisionNumber: 1, contentSha256: "a".repeat(64), plan, items: [], dependencies: [] };
const result = { planId, revisionId, revisionNumber: 2, contentSha256: "a".repeat(64), responseSha256: "b".repeat(64), replayed: false, outcome: "created" as const };
const app = (overrides: Record<string, unknown> = {}, actor: unknown = { user: { id: "user-1" }, activeWorkspace: { id: "workspace-1" }, memberRole: "member" }) => new Elysia().derive(() => actor as never).use(createDeliveryPlansRoutes({ authorize: async () => "allowed", gate: async () => {}, accept: async () => ({ ...result, revisionNumber: 1 }), acceptRevision: async () => result, read: async () => view, ...overrides } as never));
const post = (body: unknown, id = planId) => new Request(`http://localhost/delivery-plans/${id}/revisions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const response = async (route: ReturnType<typeof app>, body: unknown, id?: string) => { const value = await route.handle(post(body, id)); return { status: value.status, json: await value.json() as { code?: string; data?: typeof result } }; };

describe("delivery Plan revision contracts and route", () => {
  it("strictly bounds the revised command and keeps first acceptance pinned to revision 1", () => {
    expect(parseDeliveryPlanRevisionRequest({ requestKey: "k", expectedCurrentRevisionNumber: 1, plan })).toEqual({ requestKey: "k", expectedCurrentRevisionNumber: 1, plan });
    expect(parseDeliveryPlanRevisionRequest({ requestKey: "x".repeat(255), expectedCurrentRevisionNumber: Number.MAX_SAFE_INTEGER, plan }).requestKey).toHaveLength(255);
    const upperPayload = payloadPlan(49); expect(new TextEncoder().encode(JSON.stringify(upperPayload)).byteLength).toBeLessThan(MAX_DELIVERY_PLAN_ACCEPTANCE_BYTES); expect(parseDeliveryPlanRevisionRequest({ requestKey: "k", expectedCurrentRevisionNumber: 1, plan: upperPayload }).plan.workUnits).toHaveLength(49);
    const oversizedPayload = payloadPlan(50); expect(new TextEncoder().encode(JSON.stringify(oversizedPayload)).byteLength).toBeGreaterThan(MAX_DELIVERY_PLAN_ACCEPTANCE_BYTES);
    for (const invalid of [
      { requestKey: "", expectedCurrentRevisionNumber: 1, plan }, { requestKey: "x".repeat(256), expectedCurrentRevisionNumber: 1, plan },
      { requestKey: "k", expectedCurrentRevisionNumber: 0, plan }, { requestKey: "k", expectedCurrentRevisionNumber: Number.MAX_SAFE_INTEGER + 1, plan },
      { requestKey: "k", expectedCurrentRevisionNumber: 1, plan, actorId: "forged" }, { requestKey: "k", expectedCurrentRevisionNumber: 1, plan: oversizedPayload },
    ]) expect(() => parseDeliveryPlanRevisionRequest(invalid)).toThrow();
    const { outcome: _, ...firstResult } = result; expect(deliveryPlanAcceptanceResponseSchema.parse({ ...firstResult, revisionNumber: 1 })).toMatchObject({ revisionNumber: 1 });
    expect(() => deliveryPlanAcceptanceResponseSchema.parse({ ...result, revisionNumber: 2 })).toThrow();
    for (const outcome of ["created", "no_op"] as const) expect(deliveryPlanRevisionResponseSchema.parse({ ...result, outcome }).outcome).toBe(outcome);
    expect(() => deliveryPlanRevisionResponseSchema.parse({ ...result, outcome: "reused" })).toThrow();
    for (const code of ["acceptance_stale_revision", "acceptance_projection_blocked"] as const) expect(deliveryPlanRevisionApiErrorSchema.parse({ success: false, error: "bounded", code }).code).toBe(code);
    expect(() => deliveryPlanRevisionApiErrorSchema.parse({ success: false, error: "bounded", code: "raw_driver_error" })).toThrow();
  });

  it("derives actor scope, authorizes stored Plan scope, gates, and maps bounded revision errors", async () => {
    const seen: unknown[] = [];
    const ok = await response(app({ read: async (...args: unknown[]) => { seen.push(args); return view; }, authorize: async (scope: unknown) => { seen.push(scope); return "allowed"; }, gate: async (scope: unknown) => { seen.push(scope); }, acceptRevision: async (input: unknown) => { seen.push(input); return result; } }), { requestKey: "rev", expectedCurrentRevisionNumber: 1, plan: { ...plan, target: { projectId: "90000000-0000-4000-8000-000000000009", boardId: "80000000-0000-4000-8000-000000000008" } } });
    expect([ok.status, ok.json.data?.outcome]).toEqual([200, "created"]);
    expect(seen).toEqual([["workspace-1", planId], { workspaceId: "workspace-1", userId: "user-1", memberRole: "member", projectId, boardId }, { workspaceId: "workspace-1", projectId, boardId }, expect.objectContaining({ workspaceId: "workspace-1", userId: "user-1", planId })]);
    const request = { requestKey: "rev", expectedCurrentRevisionNumber: 1, plan };
    const cases: Array<[ReturnType<typeof app>, number, string, string?]> = [
      [app({}, { user: null }), 401, "authentication_required"], [app({ read: async () => null }), 404, "delivery_plan_not_found"], [app({ authorize: async () => "forbidden" }), 403, "acceptance_forbidden"],
      [app({ gate: async () => { throw new DeliveryPlanAcceptanceGateError(); } }), 409, "acceptance_unavailable"],
      ...(["acceptance_stale_revision", "acceptance_projection_blocked"] as const).map((code) => [app({ acceptRevision: async () => { throw new DeliveryPlanAcceptanceError(code); } }), 409, code] as [ReturnType<typeof app>, number, string]),
      [app({ acceptRevision: async () => { throw new Error("raw_driver secret"); } }), 409, "acceptance_unavailable"], [app(), 422, "invalid_delivery_plan_request", "bad-id"],
    ];
    for (const [route, status, code, id] of cases) { const actual = await response(route, request, id); expect([actual.status, actual.json.code]).toEqual([status, code]); expect(JSON.stringify(actual.json)).not.toContain("raw_driver"); }
  });
});
