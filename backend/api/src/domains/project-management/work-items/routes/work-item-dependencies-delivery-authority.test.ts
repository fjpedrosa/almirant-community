import { afterAll, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { createDatabaseMocks, createWsMock, restoreRealModules, withTestOrg } from "../../../../test/mocks";
import { testWorkspace } from "../../../../test/fixtures";
const ids: readonly [string, string] = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
type Mode = "success" | "authority" | "duplicate" | "cycle" | "missing" | "absent-source" | "absent-target";
let mode: Mode = "success";
const calls: Array<{ operation: string; args: unknown[] }> = [];
const legacyAuthorityRow = { workItemId: ids[0], itemId: null };
const { addDependency: repositoryAdd, removeDependency: repositoryRemove } = await import("../../../../../../packages/database/src/repositories/project-management/dependency-repository");
const missingExecutor = () => {
  const query: Record<string, unknown> = {}; for (const method of ["from", "innerJoin", "leftJoin"]) query[method] = () => query;
  query.where = async () => mode.startsWith("absent-") ? [{ id: mode === "absent-source" ? ids[1] : ids[0], workspaceId: testWorkspace.id, projectId: "10000000-0000-4000-8000-000000000001", boardId: "20000000-0000-4000-8000-000000000001", nativeItemId: null }] : ids.map((id) => ({ id, workspaceId: testWorkspace.id, projectId: "10000000-0000-4000-8000-000000000001", boardId: "20000000-0000-4000-8000-000000000001", nativeItemId: null }));
  return { select: () => query, execute: async () => [legacyAuthorityRow], insert: () => ({ values: () => ({ returning: async () => { throw new Error("query failed: foreign key constraint"); } }) }), delete: () => ({ where: () => ({ returning: async () => [] }) }) };
};
const compose = (operation: typeof repositoryAdd | typeof repositoryRemove, args: unknown[]) => operation(args[0] as string, args[1] as string, { workspaceId: (args[2] as { workspaceId: string }).workspaceId, executor: missingExecutor() as never });
mock.module("@almirant/database", () => createDatabaseMocks({
  addDependency: async (...args: unknown[]) => {
    calls.push({ operation: "add", args });
    if (mode === "authority" || mode.startsWith("absent-")) return compose(repositoryAdd, args);
    if (mode === "duplicate" || mode === "cycle") throw new Error(mode === "duplicate" ? "duplicate unique dependency" : "dependency cycle detected");
    return { id: "dependency-1", workItemId: args[0], blockedByWorkItemId: args[1] };
  },
  removeDependency: async (...args: unknown[]) => {
    calls.push({ operation: "remove", args });
    if (mode === "authority" || mode.startsWith("absent-")) return compose(repositoryRemove, args);
    return mode !== "missing";
  },
  isDependencyEndpointNotFoundError: (error: unknown) => (error as { code?: string })?.code === "dependency_endpoint_not_found",
  isNativePlanAuthorityError: (error: unknown) => (error as { code?: string })?.code === "native_plan_authority",
}));
mock.module("../../../../shared/ws/ws-connection-manager", createWsMock);
mock.module("../../../../domains/agents/services/resource-forecast", () => ({ buildWorkItemResourceForecast: async () => null,
  refreshResourceForecastForAffectedBlocks: async () => {} }));
const { workItemsRoutes } = await import("./work-items.routes");
const app = new Elysia().use(withTestOrg).use(workItemsRoutes);
const add = (source = ids[0], target = ids[1]) => app.handle(new Request(`http://localhost/work-items/${source}/dependencies`,
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blockedByWorkItemId: target }) }));
const remove = (source = ids[0], target = ids[1]) => app.handle(new Request(`http://localhost/work-items/${source}/dependencies/${target}`, { method: "DELETE" }));
afterAll(() => { mock.restore(); restoreRealModules(); });
describe("REST dependency delivery authority", () => {
  it("passes workspace scope through authorized add/remove and preserves generic responses", async () => {
    mode = "success"; calls.length = 0;
    const responses = [await add(), await remove(ids[1], ids[0])];
    expect(responses.map(({ status }) => status)).toEqual([201, 200]);
    expect(await responses[0]!.json()).toMatchObject({ success: true, data: { id: "dependency-1" } });
    expect(await responses[1]!.json()).toMatchObject({ success: true, data: { deleted: true } });
    expect(calls.map(({ operation, args }) => [operation, args[0], args[1], (args[2] as { workspaceId: string }).workspaceId]))
      .toEqual([["add", ids[0], ids[1], testWorkspace.id], ["remove", ids[1], ids[0], testWorkspace.id]]);
  });
  it("maps both dependency directions to bounded native_plan_authority conflicts", async () => {
    mode = "authority";
    const responses = [await add(ids[0], ids[1]), await remove(ids[1], ids[0])];
    expect(responses.map(({ status }) => status)).toEqual([409, 409]);
    for (const response of responses) {
      const body = await response.json() as { success: boolean; code: string; error: string };
      expect(body).toMatchObject({ success: false, error: "Planning fields are owned by the native Plan revision", code: "native_plan_authority" });
      expect(JSON.stringify(body)).not.toMatch(/00000000|plan-|SELECT|delivery_plan/);
    }
  });
  it.each(["absent-source", "absent-target"] as const)("composes repository %s into friendly not-found", async (absentMode) => {
    mode = absentMode;
    const responses = [await add(), await remove()];
    const resource = absentMode === "absent-source" ? "Work item" : "Blocking work item";
    expect(responses.map(({ status }) => status)).toEqual([404, 404]);
    for (const response of responses) { const body = await response.json(); expect(body).toMatchObject({ success: false, error: `${resource} not found` }); expect(JSON.stringify(body)).not.toMatch(/00000000|SELECT|query failed/); }
  });
  it("does not remap duplicate, cycle, dependency-not-found, or validation errors as authority", async () => {
    mode = "duplicate"; const duplicate = await add();
    mode = "cycle"; const cycle = await add();
    mode = "missing"; const missing = await remove();
    const self = await add(ids[0], ids[0]);
    expect([duplicate.status, cycle.status, missing.status, self.status]).toEqual([409, 500, 404, 400]);
    expect(await duplicate.json()).toMatchObject({ success: false, error: "This dependency already exists" });
    expect(await missing.json()).toMatchObject({ success: false, error: "Dependency not found" });
    expect(await self.json()).toMatchObject({ success: false, error: "A work item cannot depend on itself" });
  });
});
