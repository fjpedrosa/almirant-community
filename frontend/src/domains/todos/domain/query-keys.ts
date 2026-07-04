import type { QueryKey } from "@tanstack/react-query";

/**
 * React Query key factory for the todos domain.
 *
 * Lives in the domain layer (no runtime deps — `QueryKey` is a type-only import)
 * so the invalidation logic below is unit-testable in isolation, without dragging
 * the hook file's auth/api transitive imports.
 */
export const todoKeys = {
  all: ["todos"] as const,
  lists: () => [...todoKeys.all, "list"] as const,
  list: (filters: string) => [...todoKeys.lists(), filters] as const,
  details: () => [...todoKeys.all, "detail"] as const,
  detail: (id: string) => [...todoKeys.details(), id] as const,
  commentHistory: (todoId: string, commentId: string) =>
    [...todoKeys.all, "comment-history", todoId, commentId] as const,
};

/**
 * Query keys to invalidate after a single-item mutation
 * (create / update / delete / status / priority / owner / dueDate / tags / comment).
 *
 * Narrow scope (S2 fix): only the paginated lists + the specific item detail —
 * NEVER the whole `todoKeys.all` namespace, which would additionally refetch
 * every other item's detail, comment-history and comments query.
 * `todoKeys.lists()` also covers the item history query, which is keyed under
 * `todoKeys.list("history:...")`, so the detail panel's history section still
 * refreshes on mutation.
 */
export const todoMutationKeys = (id?: string): QueryKey[] => {
  const keys: QueryKey[] = [todoKeys.lists()];
  if (id) keys.push(todoKeys.detail(id));
  return keys;
};
