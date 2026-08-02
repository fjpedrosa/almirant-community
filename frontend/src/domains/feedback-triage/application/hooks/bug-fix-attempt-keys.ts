/**
 * Query keys for bug-fix-attempts, as consumed by the feedback-triage
 * cluster hooks (launch investigation, abort investigation, dismiss
 * cluster, batch launch) for cache invalidation after mutating an
 * attempt's lifecycle.
 *
 * Cloud co-locates this with its `domains/backoffice` bug-fix-attempts
 * list/detail page hooks (a cross-workspace admin page community does not
 * have) but explicitly documents it as shared with feedback-triage. Since
 * feedback-triage is the generic, ported half of that split, the key
 * factory itself lives here instead.
 */
export const bugFixAttemptKeys = {
  all: ["bug-fix-attempts"] as const,
  list: (filters: string) =>
    [...bugFixAttemptKeys.all, "list", filters] as const,
  detail: (id: string) => [...bugFixAttemptKeys.all, "detail", id] as const,
  byCluster: (clusterId: string) =>
    [...bugFixAttemptKeys.all, "cluster", clusterId] as const,
};
