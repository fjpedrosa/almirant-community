import type { QueryKey } from "@tanstack/react-query";

export const planningSessionKeys = {
  all: ["planning-sessions"] as const,
  lists: () => [...planningSessionKeys.all, "list"] as const,
  list: (filters: string) =>
    [...planningSessionKeys.lists(), filters] as const,
  details: () => [...planningSessionKeys.all, "detail"] as const,
  detail: (id: string) => [...planningSessionKeys.details(), id] as const,
  seeds: (id: string) =>
    [...planningSessionKeys.detail(id), "seeds"] as const,
  workItems: (id: string) =>
    [...planningSessionKeys.detail(id), "work-items"] as const,
  // Cache key for the composite transcript/replay load (jobs -> traces -> messages)
  // built by `loadMessagesFromLogs`. Nested under `detail(id)` so it invalidates
  // alongside the session detail.
  replayLogs: (id: string) =>
    [...planningSessionKeys.detail(id), "replay-logs"] as const,
  // Cache key for a single historical agent-job replay trace (keyed by jobId).
  replayTrace: (jobId: string) =>
    [...planningSessionKeys.all, "replay-trace", jobId] as const,
  // Cache key for the latest-job output batch endpoint (jobs -> output collapsed
  // into one request). Shared by the SSR prefetch and the client replay hook so
  // the dehydrated cache hydrates without a client refetch.
  latestOutput: (id: string) =>
    [...planningSessionKeys.detail(id), "latest-output"] as const,
  active: () => [...planningSessionKeys.all, "active"] as const,
};

export const seedKeys = {
  all: ["seeds"] as const,
  lists: () => [...seedKeys.all, "list"] as const,
  list: (filters: string) => [...seedKeys.lists(), filters] as const,
  details: () => [...seedKeys.all, "detail"] as const,
  detail: (id: string) => [...seedKeys.details(), id] as const,
  comments: (id: string) => [...seedKeys.detail(id), "comments"] as const,
  history: (id: string) => [...seedKeys.detail(id), "history"] as const,
  traceability: (id: string) =>
    [...seedKeys.detail(id), "traceability"] as const,
  tags: (id: string) => [...seedKeys.detail(id), "tags"] as const,
  selected: () => [...seedKeys.all, "selected"] as const,
};

/**
 * Query keys to invalidate after a single-seed mutation
 * (create / update / delete / status / owner / priority / tags / selection / comment).
 *
 * Narrow scope (S2 fix): only the paginated lists, the "selected for ideation"
 * list, and the specific seed detail — NEVER the whole `seedKeys.all` namespace,
 * which additionally refetches every OTHER seed's detail/comments/history/
 * traceability/tags query.
 *
 * Correctness notes:
 * - `seedKeys.detail(id)` is a prefix of `comments(id)`, `history(id)`,
 *   `traceability(id)` and `tags(id)`, so invalidating it (default partial match)
 *   also refreshes those nested detail-panel sub-queries.
 * - `seedKeys.selected()` is kept because it lives OUTSIDE `lists()`/`detail(id)`;
 *   selection toggles (and edits to a selected seed) must refresh it.
 */
export const seedMutationKeys = (id?: string): QueryKey[] => {
  const keys: QueryKey[] = [seedKeys.lists(), seedKeys.selected()];
  if (id) keys.push(seedKeys.detail(id));
  return keys;
};
