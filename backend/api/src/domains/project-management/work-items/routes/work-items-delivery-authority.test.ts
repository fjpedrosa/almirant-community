import { afterAll, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import { Elysia } from "elysia";
import { createDatabaseMocks, restoreRealModules, withTestOrg } from "../../../../test/mocks";
import { testWorkItem } from "../../../../test/fixtures";
let lookup: "idea" | "missing" | "not-idea" = "idea";
const authorityError = Object.assign(new Error("Planning fields are owned by the native Plan revision"), { code: "native_plan_authority" });
mock.module("@almirant/database", () => createDatabaseMocks({
  getWorkItemById: async () => lookup === "missing" ? null : { ...testWorkItem, id: "idea-1", type: lookup === "idea" ? "idea" : "task" },
  updateWorkItem: async () => { throw authorityError; }, deleteWorkItem: async () => { throw authorityError; }, changeParent: async () => { throw authorityError; },
  isNativePlanAuthorityError: (error: unknown) => (error as { code?: string })?.code === "native_plan_authority",
}));
const { mapWorkItemMutationError, workItemsRoutes } = await import("./work-items.routes"); const { workItemsTypedCreateRoutes } = await import("./work-items-typed-create.routes");
const app = new Elysia().use(withTestOrg).use(workItemsRoutes);
const promote = (body: Record<string, unknown>) => app.handle(new Request("http://localhost/work-items/idea-1/promote", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));
afterAll(() => {
  mock.restore();
  restoreRealModules();
});
describe("dedicated Idea promotion authority boundary", () => {
  it("maps update, delete, parent, and Idea promotion rejection to stable bounded HTTP 409", async () => {
    lookup = "idea";
    const requests = [new Request("http://localhost/work-items/idea-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "changed" }) }), new Request("http://localhost/work-items/idea-1", { method: "DELETE" }), new Request("http://localhost/work-items/idea-1/parent", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ parentId: null }) })];
    const responses = await Promise.all([app.handle(requests[0]!), app.handle(requests[1]!), app.handle(requests[2]!), promote({ targetType: "task" })]);
    expect(responses).toHaveLength(4);
    expect(responses.map(({ status }) => status)).toEqual([409, 409, 409, 409]);
    for (const response of responses) { const body = await response.json() as { success: boolean; code: string; error: string }; expect(body).toMatchObject({ success: false, error: "Planning fields are owned by the native Plan revision", code: "native_plan_authority" }); expect(JSON.stringify(body)).not.toContain("plan-1"); }
  });
  it("retains not-found, validation, and non-authority error mappings", async () => {
    lookup = "missing";
    expect((await promote({ targetType: "task" })).status).toBe(404);
    lookup = "not-idea";
    expect((await promote({ targetType: "task" })).status).toBe(400);
    lookup = "idea";
    expect((await promote({ targetType: "unsupported" })).status).toBe(400);
    const set = {};
    expect(mapWorkItemMutationError(new Error("forbidden"), set)).toBeNull();
    expect(set).toEqual({});
  });
});
describe("typed-create isolation", () => {
  it("pins the legacy route bytes and exposes no native creation or acceptance route", async () => {
    const bytes = await Bun.file(new URL("./work-items-typed-create.routes.ts", import.meta.url)).arrayBuffer();
    expect(createHash("sha256").update(new Uint8Array(bytes)).digest("hex")).toBe("f279b717afea9f5eba9829cf780397aaa6bcf0026e2f2bdb51bd73f73bd3bff0");
    const typed = new Elysia().use(workItemsTypedCreateRoutes);
    expect((await typed.handle(new Request("http://localhost/work-units", { method: "POST" }))).status).toBe(404);
    expect((await typed.handle(new Request("http://localhost/delivery-plans/accept", { method: "POST" }))).status).toBe(404);
  });
});
