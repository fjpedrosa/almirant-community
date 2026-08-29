import { describe, expect, test } from "bun:test";
import {
  classifyDeliveryAuthority,
  type DeliveryAuthorityFact,
  type DeliveryAuthorityScope,
} from "./delivery-authority";

const scope: DeliveryAuthorityScope = { workspaceId: "ws", projectId: "project", boardId: "board" };
const fact: DeliveryAuthorityFact = {
  planId: "plan",
  itemId: "item",
  itemKind: "work_unit",
  planWorkspaceId: "ws",
  planProjectId: "project",
  planBoardId: "board",
  workItemWorkspaceId: "ws",
  workItemProjectId: "project",
  workItemBoardId: "board",
  workItemType: "task",
  parentId: null,
  size: "M",
  sizeOrigin: "plan",
  backlogIntent: "new",
  currentRevisionId: "revision",
  membership: "current",
};

const classify = (overrides: Partial<DeliveryAuthorityFact> = {}) =>
  classifyDeliveryAuthority(scope, [{ ...fact, ...overrides }]);

describe("classifyDeliveryAuthority", () => {
  test("classifies legacy, current, and retired authority", () => {
    expect(classifyDeliveryAuthority(scope, [])).toEqual({ kind: "legacy" });
    expect(classify()).toEqual({ kind: "native_work_unit", planId: "plan", itemId: "item", currentRevisionId: "revision" });
    expect(classify({ membership: "retired" })).toEqual({ kind: "native_retired", planId: "plan", itemId: "item" });
  });

  test.each([
    [{ itemKind: "feature" }, "feature_work_item_link"],
    [{ planWorkspaceId: "other" }, "native_scope_mismatch"],
    [{ currentRevisionId: null }, "native_link_partial"],
    [{ membership: "missing" }, "native_link_partial"],
    [{ workItemType: "story" }, "native_work_item_type_invalid"],
    [{ parentId: "parent" }, "native_work_item_parented"],
    [{ size: null }, "native_qualifier_missing"],
    [{ size: "XXL" }, "native_qualifier_missing"],
    [{ sizeOrigin: null }, "native_qualifier_missing"],
    [{ backlogIntent: null }, "native_qualifier_missing"],
  ] as const)("fails closed with %s", (overrides, code) => {
    expect(classify(overrides)).toEqual({ kind: "incompatible", code });
  });

  test("rejects duplicate and current/retired membership conflict", () => {
    expect(classifyDeliveryAuthority(scope, [fact, { ...fact, membership: "retired" }])).toEqual({
      kind: "incompatible",
      code: "native_link_conflict",
    });
  });
});
