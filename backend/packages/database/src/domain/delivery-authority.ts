export type DeliveryAuthorityCode =
  | "native_link_conflict"
  | "native_link_partial"
  | "native_scope_mismatch"
  | "feature_work_item_link"
  | "native_work_item_type_invalid"
  | "native_work_item_parented"
  | "native_qualifier_missing";

export type DeliveryAuthority =
  | { kind: "legacy" }
  | { kind: "native_work_unit"; planId: string; itemId: string; currentRevisionId: string }
  | { kind: "native_retired"; planId: string; itemId: string }
  | { kind: "incompatible"; code: DeliveryAuthorityCode };

export interface DeliveryAuthorityScope {
  workspaceId: string;
  projectId: string;
  boardId: string;
}

export interface DeliveryAuthorityFact {
  planId: string | null;
  itemId: string | null;
  itemKind: string | null;
  planWorkspaceId: string | null;
  planProjectId: string | null;
  planBoardId: string | null;
  workItemWorkspaceId: string | null;
  workItemProjectId: string | null;
  workItemBoardId: string | null;
  workItemType: string;
  parentId: string | null;
  size: string | null;
  sizeOrigin: string | null;
  backlogIntent: string | null;
  currentRevisionId: string | null;
  membership: "current" | "retired" | "missing" | "conflict";
}

const incompatible = (code: DeliveryAuthorityCode): DeliveryAuthority => ({ kind: "incompatible", code });

export const classifyDeliveryAuthority = (
  scope: DeliveryAuthorityScope,
  facts: readonly DeliveryAuthorityFact[],
): DeliveryAuthority => {
  if (facts.length === 0) return { kind: "legacy" };
  if (facts.length !== 1 || facts[0]!.membership === "conflict") return incompatible("native_link_conflict");
  const fact = facts[0]!;
  if (!fact.planId || !fact.itemId || !fact.currentRevisionId || fact.membership === "missing") return incompatible("native_link_partial");
  if (fact.itemKind === "feature") return incompatible("feature_work_item_link");
  if (fact.itemKind !== "work_unit") return incompatible("native_link_partial");
  if (
    fact.planWorkspaceId !== scope.workspaceId || fact.planProjectId !== scope.projectId ||
    fact.planBoardId !== scope.boardId || fact.workItemWorkspaceId !== scope.workspaceId ||
    fact.workItemProjectId !== scope.projectId || fact.workItemBoardId !== scope.boardId
  ) return incompatible("native_scope_mismatch");
  if (fact.workItemType !== "task") return incompatible("native_work_item_type_invalid");
  if (fact.parentId !== null) return incompatible("native_work_item_parented");
  if (!["XS", "S", "M", "L", "XL"].includes(fact.size ?? "") || fact.sizeOrigin !== "plan" || !["new", "fix"].includes(fact.backlogIntent ?? "")) return incompatible("native_qualifier_missing");
  return fact.membership === "current"
    ? { kind: "native_work_unit", planId: fact.planId, itemId: fact.itemId, currentRevisionId: fact.currentRevisionId }
    : { kind: "native_retired", planId: fact.planId, itemId: fact.itemId };
};
