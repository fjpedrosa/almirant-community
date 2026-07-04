import type { QueryKey } from "@tanstack/react-query";

/**
 * React Query key factory for the expenses domain.
 *
 * Lives in the domain layer (no runtime deps — `QueryKey` is a type-only import)
 * so the invalidation logic below is unit-testable in isolation, without dragging
 * the hook file's auth/api transitive imports.
 */
export const expenseKeys = {
  all: ["expenses"] as const,
  lists: () => [...expenseKeys.all, "list"] as const,
  list: (filters: string) => [...expenseKeys.lists(), filters] as const,
  details: () => [...expenseKeys.all, "detail"] as const,
  detail: (id: string) => [...expenseKeys.details(), id] as const,
  aggregations: (filters: string) =>
    [...expenseKeys.all, "aggregations", filters] as const,
  /** Prefix that matches every `aggregations(filters)` variant. */
  aggregationsAll: () => [...expenseKeys.all, "aggregations"] as const,
  categories: () => [...expenseKeys.all, "categories"] as const,
  recurring: () => [...expenseKeys.all, "recurring"] as const,
};

/**
 * Query keys to invalidate after a single-expense mutation
 * (create / update / delete / invoice upload).
 *
 * Narrow scope (S2 fix): the paginated lists, the aggregations (dashboard totals
 * / charts change with any expense), and the specific expense detail — NEVER the
 * whole `expenseKeys.all` namespace, which additionally refetches every other
 * expense's detail plus the unrelated `categories()` and `recurring()` lists.
 *
 * `categories()` and `recurring()` are intentionally left intact: they are
 * managed by their own dedicated mutations and are unaffected by expense edits.
 */
export const expenseMutationKeys = (id?: string): QueryKey[] => {
  const keys: QueryKey[] = [expenseKeys.lists(), expenseKeys.aggregationsAll()];
  if (id) keys.push(expenseKeys.detail(id));
  return keys;
};
