import type { QueryKey } from "@tanstack/react-query";

/**
 * React Query key factory for the ideas domain.
 *
 * Lives in the domain layer (no runtime deps — `QueryKey` is a type-only import)
 * so the invalidation logic below is unit-testable in isolation, without dragging
 * the hook file's auth/api transitive imports.
 */
export const ideaKeys = {
  all: ["ideas"] as const,
  lists: () => [...ideaKeys.all, "list"] as const,
  list: (filters: string) => [...ideaKeys.lists(), filters] as const,
  details: () => [...ideaKeys.all, "detail"] as const,
  detail: (id: string) => [...ideaKeys.details(), id] as const,
  commentHistory: (ideaItemId: string, commentId: string) =>
    [...ideaKeys.all, "comment-history", ideaItemId, commentId] as const,
  traceability: () => [...ideaKeys.all, "traceability"] as const,
  traceabilityById: (id: string) => [...ideaKeys.traceability(), id] as const,
};

/**
 * Query keys to invalidate after a single-item mutation
 * (create / update / delete / status / owner / dueDate / tags / comment).
 *
 * Narrow scope (S2 fix): only the paginated lists + the specific item detail —
 * NEVER the whole `ideaKeys.all` namespace, which would additionally refetch
 * every other item's detail, traceability, comment-history and comments query.
 * `ideaKeys.lists()` also covers the item history query, which is keyed under
 * `ideaKeys.list("history:...")`, so the detail panel's history section still
 * refreshes on mutation.
 */
export const ideaMutationKeys = (id?: string): QueryKey[] => {
  const keys: QueryKey[] = [ideaKeys.lists()];
  if (id) keys.push(ideaKeys.detail(id));
  return keys;
};
