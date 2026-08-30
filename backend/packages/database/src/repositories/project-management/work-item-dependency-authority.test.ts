import { describe, expect, mock, test } from "bun:test";
import type { DeliveryAuthorityFact } from "../../domain/delivery-authority";
import { addDependency, removeDependency, type DependencyMutationExecutor } from "./dependency-repository";
const ids: readonly [string, string] = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
const scopeRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, workspaceId: "workspace-1", projectId: "10000000-0000-4000-8000-000000000001",
  boardId: "20000000-0000-4000-8000-000000000001", nativeItemId: null, type: "task", ...overrides,
});
const authorityRow = (workItemId: string, overrides: Partial<DeliveryAuthorityFact> = {}) => ({ workItemId, itemId: null, ...overrides });
const nativeRow = (workItemId: string, overrides: Partial<DeliveryAuthorityFact> = {}) => authorityRow(workItemId, {
  planId: "30000000-0000-4000-8000-000000000001", itemId: "40000000-0000-4000-8000-000000000001", itemKind: "work_unit",
  planWorkspaceId: "workspace-1", planProjectId: "10000000-0000-4000-8000-000000000001", planBoardId: "20000000-0000-4000-8000-000000000001",
  workItemWorkspaceId: "workspace-1", workItemProjectId: "10000000-0000-4000-8000-000000000001", workItemBoardId: "20000000-0000-4000-8000-000000000001",
  workItemType: "task", parentId: null, size: "M", sizeOrigin: "plan", backlogIntent: "new", currentRevisionId: "50000000-0000-4000-8000-000000000001", membership: "current", ...overrides,
});
const harness = (options: { scopeRows?: Array<Record<string, unknown>>; authorityRows?: Array<Record<string, unknown>>; insertError?: Error; removed?: boolean } = {}) => {
  const query: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "leftJoin"]) query[method] = () => query;
  query.where = async () => options.scopeRows ?? ids.map((id) => scopeRow(id));
  const select = mock(() => query);
  const execute = mock(async () => options.authorityRows ?? ids.map((id) => authorityRow(id)));
  const dependency = { id: "dependency-1", workItemId: ids[0], blockedByWorkItemId: ids[1], createdAt: new Date(0) };
  const insert = mock(() => ({ values: () => ({ returning: async () => { if (options.insertError) throw options.insertError; return [dependency]; } }) }));
  const deleteMutation = mock(() => ({ where: () => ({ returning: async () => options.removed === false ? [] : [dependency] }) }));
  return { select, execute, insert, delete: deleteMutation, executor: { select, execute, insert, delete: deleteMutation } as unknown as DependencyMutationExecutor, dependency };
};
const context = (executor: DependencyMutationExecutor) => ({ workspaceId: "workspace-1", executor });
const expectAuthorityConflict = async (operation: Promise<unknown>) => {
  try { await operation; throw new Error("expected conflict"); } catch (error) {
    expect((error as { code?: string }).code).toBe("native_plan_authority"); expect((error as Error).message).toBe("Planning fields are owned by the native Plan revision");
    expect(JSON.stringify(error)).not.toContain("30000000");
  }
};
const expectEndpointNotFound = async (operation: Promise<unknown>, endpoint: "source" | "target") => {
  try { await operation; throw new Error("expected endpoint not found"); } catch (error) {
    expect(error).toMatchObject({ code: "dependency_endpoint_not_found", endpoint }); expect((error as Error).message).toBe(`${endpoint === "source" ? "Work item" : "Blocking work item"} not found or does not belong to your workspace`);
    expect(JSON.stringify(error)).not.toMatch(/00000000|SELECT|query failed/);
  }
};
describe("guarded dependency repository mutations", () => {
  test("preserves every legacy type and uses one two-endpoint authority batch per mutation", async () => {
    for (const type of ["epic", "feature", "story", "task", "idea"]) {
      const h = harness({ scopeRows: [scopeRow(ids[0], { type }), scopeRow(ids[1], { type })] });
      expect(await addDependency(ids[0], ids[1], context(h.executor))).toEqual(h.dependency);
      expect([h.select.mock.calls.length, h.execute.mock.calls.length, h.insert.mock.calls.length]).toEqual([1, 1, 1]);
    }
    const h = harness();
    expect(await removeDependency(ids[1], ids[0], context(h.executor))).toBeTrue();
    expect([h.select.mock.calls.length, h.execute.mock.calls.length, h.delete.mock.calls.length]).toEqual([1, 1, 1]);
  });
  test.each([[0, "source"], [1, "target"]] as const)("returns structured %s endpoint absence before authority classification", async (missingIndex, endpoint) => {
    const scopeRows = ids.filter((_, index) => index !== missingIndex).map((id) => scopeRow(id));
    const addition = harness({ scopeRows, insertError: new Error("query failed: foreign key constraint") });
    await expectEndpointNotFound(addDependency(ids[0], ids[1], context(addition.executor)), endpoint); expect([addition.select.mock.calls.length, addition.execute.mock.calls.length, addition.insert.mock.calls.length]).toEqual([1, 0, 0]);
    const removal = harness({ scopeRows, removed: false });
    await expectEndpointNotFound(removeDependency(ids[0], ids[1], context(removal.executor)), endpoint); expect([removal.select.mock.calls.length, removal.execute.mock.calls.length, removal.delete.mock.calls.length]).toEqual([1, 0, 0]);
  });
  test.each([[nativeRow(ids[0])], [nativeRow(ids[1])], [nativeRow(ids[0], { membership: "retired" })],
    [nativeRow(ids[1], { membership: "missing", currentRevisionId: null })], [nativeRow(ids[0], { planWorkspaceId: "foreign" })]] as const)
  ("denies native, retired, partial, and incompatible endpoint authority", async (blockedRow) => {
    const h = harness({ authorityRows: ids.map((id) => id === blockedRow.workItemId ? blockedRow : authorityRow(id)) });
    await expectAuthorityConflict(addDependency(ids[0], ids[1], context(h.executor)));
    expect([h.execute.mock.calls.length, h.insert.mock.calls.length]).toEqual([1, 0]);
  });
  test("fails closed for omitted authority and cross workspace/project/board scope in either direction", async () => {
    const missing = harness({ authorityRows: [authorityRow(ids[0])] });
    await expectAuthorityConflict(removeDependency(ids[0], ids[1], context(missing.executor)));
    for (const mismatch of [{ workspaceId: "foreign" }, { projectId: "10000000-0000-4000-8000-000000000099" }, { boardId: "20000000-0000-4000-8000-000000000099" }]) {
      const h = harness({ scopeRows: [scopeRow(ids[0]), scopeRow(ids[1], mismatch)] });
      await expectAuthorityConflict(addDependency(ids[1], ids[0], context(h.executor)));
      expect([h.execute.mock.calls.length, h.insert.mock.calls.length]).toEqual([0, 0]);
    }
  });
  test("triangulates projectless legacy Ideas without permitting a partial native link", async () => {
    const rows = ids.map((id) => scopeRow(id, { projectId: null, type: "idea" }));
    const legacy = harness({ scopeRows: rows });
    expect(await addDependency(ids[0], ids[1], context(legacy.executor))).toEqual(legacy.dependency);
    expect(legacy.execute).not.toHaveBeenCalled();
    const linked = harness({ scopeRows: [rows[0]!, { ...rows[1]!, nativeItemId: "partial-native-link" }] });
    await expectAuthorityConflict(addDependency(ids[1], ids[0], context(linked.executor)));
    expect(linked.insert).not.toHaveBeenCalled();
  });
  test("preserves duplicate, cycle, exact replay, and missing-edge repository errors", async () => {
    for (const message of ["duplicate unique dependency", "dependency cycle detected"]) {
      const error = new Error(message); const h = harness({ insertError: error });
      await expect(addDependency(ids[0], ids[1], context(h.executor))).rejects.toBe(error);
    }
    expect(await removeDependency(ids[0], ids[1], context(harness({ removed: false }).executor))).toBeFalse();
  });
  test("guards the transaction-executor compatibility call instead of exposing a raw insert bypass", async () => {
    const h = harness({ authorityRows: [nativeRow(ids[0]), authorityRow(ids[1])] });
    await expectAuthorityConflict(addDependency(ids[0], ids[1], h.executor));
    expect([h.execute.mock.calls.length, h.insert.mock.calls.length]).toEqual([1, 0]);
  });
});
