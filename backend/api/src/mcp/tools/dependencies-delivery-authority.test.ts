import { afterAll, describe, expect, it, mock } from "bun:test";
import { createDatabaseMocks, restoreRealModules } from "../../test/mocks";
const ids: readonly [string, string] = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
type Mode = "success" | "authority" | "duplicate" | "cycle" | "missing" | "absent-source" | "absent-target";
let mode: Mode = "success";
const calls: Array<{ operation: string; args: unknown[] }> = [];
const legacyAuthorityRow = { workItemId: ids[0], itemId: null };
const { addDependency: repositoryAdd, removeDependency: repositoryRemove } = await import("../../../../packages/database/src/repositories/project-management/dependency-repository");
const missingExecutor = () => {
  const query: Record<string, unknown> = {}; for (const method of ["from", "innerJoin", "leftJoin"]) query[method] = () => query;
  query.where = async () => mode.startsWith("absent-") ? [{ id: mode === "absent-source" ? ids[1] : ids[0], workspaceId: "workspace-1", projectId: "10000000-0000-4000-8000-000000000001", boardId: "20000000-0000-4000-8000-000000000001", nativeItemId: null }] : ids.map((id) => ({ id, workspaceId: "workspace-1", projectId: "10000000-0000-4000-8000-000000000001", boardId: "20000000-0000-4000-8000-000000000001", nativeItemId: null }));
  return { select: () => query, execute: async () => [legacyAuthorityRow], insert: () => ({ values: () => ({ returning: async () => { throw new Error("query failed: foreign key constraint"); } }) }), delete: () => ({ where: () => ({ returning: async () => [] }) }) };
};
const compose = (operation: typeof repositoryAdd | typeof repositoryRemove, args: unknown[]) => operation(args[0] as string, args[1] as string, { workspaceId: (args[2] as { workspaceId: string }).workspaceId, executor: missingExecutor() as never });
mock.module("@almirant/database", () => createDatabaseMocks({
  getWorkItemById: async () => { throw new Error("mutation performed an endpoint N+1 lookup"); },
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
type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type Handler = (params: Record<string, string>, extra: Record<string, unknown>) => Promise<ToolResult>;
const tools = new Map<string, Handler>(); const server = { tool: (name: string, _description: string, _schema: unknown, handler: Handler) => { tools.set(name, handler); } };
const { registerDependenciesTools } = await import("./dependencies.tools");
registerDependenciesTools(server as never);
const withOrg = { authInfo: { extra: { workspaceId: "workspace-1" } } };
const invoke = (name: string, params = { workItemId: ids[0], blockedByWorkItemId: ids[1] }, extra: Record<string, unknown> = withOrg) => tools.get(name)!(params, extra);
afterAll(() => { mock.restore(); restoreRealModules(); });
describe("MCP dependency delivery authority", () => {
  it("routes add/remove through workspace-scoped repository guards without endpoint N+1 lookups", async () => {
    mode = "success"; calls.length = 0;
    const added = await invoke("add_work_item_dependency");
    const removed = await invoke("remove_work_item_dependency", { workItemId: ids[1], blockedByWorkItemId: ids[0] });
    expect([added.isError, removed.isError]).toEqual([undefined, undefined]);
    expect(JSON.parse(added.content[0]!.text)).toMatchObject({ id: "dependency-1" });
    expect(JSON.parse(removed.content[0]!.text)).toEqual({ removed: true });
    expect(calls.map(({ operation, args }) => [operation, args[0], args[1], (args[2] as { workspaceId: string }).workspaceId]))
      .toEqual([["add", ids[0], ids[1], "workspace-1"], ["remove", ids[1], ids[0], "workspace-1"]]);
  });
  it("returns the same bounded authority conflict for source, target, add, and remove", async () => {
    mode = "authority";
    const results = [await invoke("add_work_item_dependency"), await invoke("add_work_item_dependency",
      { workItemId: ids[1], blockedByWorkItemId: ids[0] }), await invoke("remove_work_item_dependency")];
    expect(results.map(({ isError }) => isError)).toEqual([true, true, true]);
    for (const result of results) {
      expect(result.content[0]!.text).toBe("Error: Planning fields are owned by the native Plan revision");
      expect(result.content[0]!.text).not.toMatch(/00000000|plan-|SELECT|delivery_plan/);
    }
  });
  it.each(["absent-source", "absent-target"] as const)("composes repository %s into friendly not-found", async (absentMode) => {
    mode = absentMode;
    const results = [await invoke("add_work_item_dependency"), await invoke("remove_work_item_dependency")];
    const endpoint = absentMode === "absent-source" ? "Work item" : "Blocking work item";
    expect(results.map((result) => result.content[0]!.text)).toEqual(Array(2).fill(`Error: ${endpoint} not found or does not belong to your workspace`));
    expect(results.map(({ isError }) => isError)).toEqual([true, true]); expect(results.map(({ content }) => content[0]!.text).join("\n")).not.toMatch(/00000000|SELECT|query failed/);
  });
  it("preserves duplicate, cycle, missing-edge, self-validation, and org-permission errors", async () => {
    mode = "duplicate"; const duplicate = await invoke("add_work_item_dependency");
    mode = "cycle"; const cycle = await invoke("add_work_item_dependency");
    mode = "missing"; const missing = await invoke("remove_work_item_dependency");
    const self = await invoke("add_work_item_dependency", { workItemId: ids[0], blockedByWorkItemId: ids[0] });
    const denied = await invoke("add_work_item_dependency", undefined, {});
    expect([duplicate.content[0]!.text, cycle.content[0]!.text]).toEqual(
      ["Error adding dependency: duplicate unique dependency", "Error adding dependency: dependency cycle detected"]);
    expect(missing.content[0]!.text).toBe(`Error: Dependency not found between work item '${ids[0]}' and blocking item '${ids[1]}'`);
    expect(self.content[0]!.text).toBe("Error: A work item cannot depend on itself");
    expect(denied.content[0]!.text).toBe("Error: could not resolve workspaceId from API key");
  });
});
