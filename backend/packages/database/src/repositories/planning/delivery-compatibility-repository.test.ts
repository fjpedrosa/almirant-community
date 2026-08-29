import { describe, expect, mock, test } from "bun:test";
import {
  CompatibilityReadinessError,
  assertNativePlanCompatibilityReady,
  loadDeliveryAuthorities,
  type DeliveryCompatibilityExecutor,
} from "./delivery-compatibility-repository";

const scope = { workspaceId: "ws", projectId: "project", boardId: "board" };
const ready = { tableCount: 5, checkCount: 15, boardColumnRequired: true, scopeMatches: true, backlogCount: 1, canonicalBacklogCount: 1, incompatibleCount: 0 };
const executor = (rows: unknown[]) => {
  const execute = mock(async () => rows);
  return { execute, value: { execute } as DeliveryCompatibilityExecutor };
};

describe("delivery compatibility repository", () => {
  test("classifies a requested page with one parameterized batch", async () => {
    const { execute, value } = executor([
      { workItemId: "legacy", itemId: null },
      { workItemId: "native", itemId: "item", planId: "plan", itemKind: "work_unit", planWorkspaceId: "ws", planProjectId: "project", planBoardId: "board", workItemWorkspaceId: "ws", workItemProjectId: "project", workItemBoardId: "board", workItemType: "task", parentId: null, size: "M", sizeOrigin: "plan", backlogIntent: "fix", currentRevisionId: "revision", membership: "current" },
    ]);
    expect(await loadDeliveryAuthorities(["legacy", "native"], scope, value)).toEqual({
      legacy: { kind: "legacy" },
      native: { kind: "native_work_unit", planId: "plan", itemId: "item", currentRevisionId: "revision" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(loadDeliveryAuthorities(Array(201).fill("00000000-0000-4000-8000-000000000000"), scope, value)).rejects.toThrow("delivery_authority_batch_limit");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test.each([{ code: "42703" }, { cause: { code: "42703" } }])("bounds undefined-column errors", async (error) => {
    const value = { execute: mock(async () => { throw error; }) } as DeliveryCompatibilityExecutor;
    await expect(assertNativePlanCompatibilityReady(scope, value)).rejects.toEqual(
      new CompatibilityReadinessError("compatibility_schema_not_ready"),
    );
  });

  test.each([
    [{ ...ready, tableCount: 4 }, "compatibility_schema_not_ready"],
    [{ ...ready, boardColumnRequired: false }, "board_column_nullable"],
    [{ ...ready, scopeMatches: false }, "compatibility_scope_mismatch"],
    [{ ...ready, backlogCount: 2 }, "canonical_backlog_required"],
    [{ ...ready, incompatibleCount: 1 }, "incompatible_native_links"],
  ] as const)("reports bounded readiness diagnostic %s", async (row, code) => {
    const { value } = executor([row]);
    await expect(assertNativePlanCompatibilityReady(scope, value)).rejects.toEqual(
      new CompatibilityReadinessError(code),
    );
  });
});
