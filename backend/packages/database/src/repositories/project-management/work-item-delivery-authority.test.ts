import { afterAll, describe, expect, it, mock } from "bun:test";
import { boardColumns, boards, deliveryPlanItems, projects, user, workItems } from "../../schema";
import type { DeliveryAuthority } from "../../domain/delivery-authority";
const realClient = { ...(await import("../../client")) }; const realAssignees = { ...(await import("./assignee-repository")) };
const realCompatibility = { ...(await import("../planning/delivery-compatibility-repository")) };
const native: DeliveryAuthority = { kind: "native_work_unit", planId: "plan-1", itemId: "item-1", currentRevisionId: "revision-1" };
const legacyTypes = ["epic", "feature", "story", "task", "idea"] as const;
const planMetadataKeys = ["acceptance", "duration", "rollbackBoundary", "reviewBudgetLines", "acceptanceCriteria", "acceptance_criteria", "dependencies", "blockedBy", "workUnitSize", "work_unit_size", "workUnitSizeOrigin", "work_unit_size_origin"];
const planMetadata = Object.fromEntries(planMetadataKeys.map((key) => [key, `${key}-current`]));
const baseItem = { id: "native", taskId: "T-1", title: "Native", description: null, type: "task", priority: "high", assignee: null, projectId: "project-1", boardId: "board-1", boardColumnId: "column-1", parentId: null, metadata: { ...planMetadata, retainedOperational: true }, position: 0, createdByUserId: null, archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0) };
const legacyItems = legacyTypes.map((type, index) => ({ ...baseItem, id: `legacy-${type}`, taskId: `L-${index}`, type, projectId: type === "idea" ? null : "project-1" }));
const idea = { ...baseItem, id: "projectless-idea", taskId: "I-1", type: "idea", projectId: null };
const column = { id: "column-1", boardId: "board-1", name: "Todo", color: null, order: 0, role: "todo", isDone: false, createdAt: new Date(0), updatedAt: new Date(0) };
let mode: "list" | "detail" | "projectless-detail" | "board" | "area" | "update" = "list";
const authorityCalls: Array<{ ids: readonly string[]; projectId: string; boardId: string }> = [];
const rowsFor = (table: unknown, selection?: Record<string, unknown>, joins: unknown[] = []): unknown[] => {
  if (table === deliveryPlanItems) return [];
  if (table === workItems) {
    if (selection?.item) return mode === "projectless-detail" && !joins.includes(boards) ? [] : [{ item: mode === "projectless-detail" ? idea : baseItem, authorityWorkspaceId: "workspace-1" }];
    if (selection?.count) return [{ count: legacyItems.length + 1 }];
    if (selection?.parentId && !selection.taskId && !selection.type) return [baseItem];
    if (!selection) return mode === "update" ? [{ work_items: baseItem }] : mode === "list" ? [...legacyItems, baseItem] : [baseItem, idea];
    if (selection.taskId) return mode === "list" ? [...legacyItems, baseItem] : [baseItem, idea];
    return [];
  }
  if (table === boards) return selection?.name && !selection.id ? [{ name: "Board" }] : [{ id: "board-1", name: "Board" }];
  if (table === boardColumns) return selection ? [{ ...column }] : [column];
  if (table === projects) return selection?.name && !selection.id ? [{ name: "Project" }] : [{ id: "project-1", name: "Project", color: null }];
  if (table === user) return [];
  return [];
};
const select = (selection?: Record<string, unknown>) => {
  let table: unknown; const joins: unknown[] = []; const builder: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "where", "orderBy", "limit", "offset", "groupBy"]) builder[method] = (value?: unknown) => { if (method === "from") table = value; if (method === "innerJoin") joins.push(value); return builder; };
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(rowsFor(table, selection, joins)).then(resolve, reject); return builder;
};
let persistedUpdate: Record<string, unknown> = {};
const update = () => ({ set: (values: Record<string, unknown>) => { persistedUpdate = values; return { where: () => ({ returning: async () => [{ ...baseItem, ...values }] }) }; } });
mock.module("../../client", () => ({ db: { select, update } }));
mock.module("./assignee-repository", () => ({ ...realAssignees, getAssigneesByWorkItem: async () => [], getAssigneesByWorkItemIds: async () => new Map() }));
mock.module("../planning/delivery-compatibility-repository", () => ({ ...realCompatibility,
  loadDeliveryAuthorities: async (ids: readonly string[], scope: { projectId: string; boardId: string }) => {
    authorityCalls.push({ ids: [...ids], projectId: scope.projectId, boardId: scope.boardId });
    return Object.fromEntries(ids.map((id) => [id, id === "native" ? native : { kind: "legacy" }])) as Record<string, DeliveryAuthority>;
  },
}));
const repository = await import("./work-item-repository");
afterAll(() => {
  mock.module("../../client", () => realClient); mock.module("./assignee-repository", () => realAssignees);
  mock.module("../planning/delivery-compatibility-repository", () => realCompatibility); mock.restore();
});
describe("core work-item delivery authority readers", () => {
  it("projects list, detail, board, and area through one scoped authority batch each", async () => {
    authorityCalls.length = 0; mode = "list";
    const list = await repository.getWorkItems("workspace-1", { page: 1, limit: 20, offset: 0 }); mode = "detail";
    const detail = await repository.getWorkItemById("native", "workspace-1"); mode = "board";
    const board = await repository.getWorkItemsByBoard("workspace-1", "board-1"); mode = "area";
    const area = await repository.getWorkItemsByArea("workspace-1", "desarrollo"); mode = "projectless-detail";
    const projectlessDetail = await repository.getWorkItemById("projectless-idea", "workspace-1");
    expect(list.items.slice(0, 5).map(({ type, deliveryAuthority }) => [type, deliveryAuthority.kind])).toEqual(legacyTypes.map((type) => [type, "legacy"]));
    expect([list.items.at(-1), detail, board[0]!.items[0], area[0]!.items[0]].map((item) => item?.deliveryAuthority)).toEqual([native, native, native, native]);
    expect([board[0]!.items[1]!.id, board[0]!.items[1]!.deliveryAuthority, projectlessDetail?.deliveryAuthority]).toEqual(["projectless-idea", { kind: "legacy" }, { kind: "legacy" }]);
    expect(authorityCalls).toEqual([{ ids: [...legacyItems.filter(({ projectId }) => projectId).map(({ id }) => id), "native"], projectId: "project-1", boardId: "board-1" }, ...Array.from({ length: 3 }, () => ({ ids: ["native"], projectId: "project-1", boardId: "board-1" }))]);
  });
  it("chunks each project/board scope at 200 and fails closed on omitted authority", async () => {
    const calls: number[] = [];
    const items = Array.from({ length: 201 }, (_, index) => ({ id: `item-${index}`, projectId: "project-1", boardId: "board-1" }));
    const projected = await repository.projectWorkItemDeliveryAuthorities("workspace-1", items, async (ids) => { calls.push(ids.length);
      if (ids.length === 1) return { [ids[0]!]: { kind: "incompatible", code: "native_link_partial" } } as Record<string, DeliveryAuthority>;
      return { ...Object.fromEntries(ids.slice(0, -2).map((id) => [id, { kind: "legacy" }])), [ids.at(-2)!]: { kind: "native_retired", planId: "plan-1", itemId: "retired" } } as Record<string, DeliveryAuthority>;
    });
    expect(calls).toEqual([200, 1]);
    expect(projected.slice(-3).map(({ deliveryAuthority }) => deliveryAuthority.kind)).toEqual(["native_retired", "incompatible", "incompatible"]);
  });
  it("scopes projectless list rows through their board workspace", async () => expect(await Bun.file(new URL("./work-item-repository.ts", import.meta.url)).text()).toContain("and(isNull(workItems.projectId), inArray(workItems.boardId, orgBoardIds))"));
});
describe("native Plan mutation guard", () => {
  it("allows all legacy edits and unchanged native Plan values", () => {
    for (const type of legacyTypes) expect(() => repository.assertDeliveryAuthorityMutationAllowed({ kind: "legacy" }, { title: type, type })).not.toThrow();
    expect(() => repository.assertDeliveryAuthorityMutationAllowed(native, { title: "Native" }, { title: "Native" })).not.toThrow();
  });
  it("preserves omitted Plan metadata while applying operational metadata", async () => {
    mode = "update"; persistedUpdate = {};
    await repository.updateWorkItem("workspace-1", "native", { metadata: { managedBy: "codex" } });
    expect(persistedUpdate.metadata).toEqual({ ...planMetadata, retainedOperational: true, managedBy: "codex" });
    for (const key of planMetadataKeys) {
      expect(() => repository.assertDeliveryAuthorityMutationAllowed(native, { metadata: { [key]: planMetadata[key] } }, { metadata: planMetadata })).not.toThrow();
      expect(() => repository.assertDeliveryAuthorityMutationAllowed(native, { metadata: { [key]: "changed" } }, { metadata: planMetadata })).toThrow(repository.NativePlanAuthorityError);
    }
  });
  it("allows unchanged null parent but denies changed or invalid-authority mutations", async () => {
    mode = "detail"; persistedUpdate = {};
    expect(await repository.changeParent("workspace-1", "native", null)).toBeTrue(); expect(persistedUpdate.parentId).toBeNull();
    await expect(repository.changeParent("workspace-1", "native", "parent")).rejects.toBeInstanceOf(repository.NativePlanAuthorityError);
    for (const [authority, update] of [[native, { deleted: true }], [{ kind: "native_retired", planId: "plan-1", itemId: "item-1" }, { priority: "high" }], [{ kind: "incompatible", code: "native_link_partial" }, { priority: "high" }]] as const) {
      expect(() => repository.assertDeliveryAuthorityMutationAllowed(authority, update)).toThrow(repository.NativePlanAuthorityError);
    }
  });
});
