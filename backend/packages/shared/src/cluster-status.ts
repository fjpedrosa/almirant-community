/**
 * Feedback cluster status — shared source of truth for both the runtime
 * (`ACTIVE_CLUSTER_STATUSES`) and the compile-time (`ClusterStatus`) view of
 * the `feedback_cluster_status` Postgres enum.
 *
 * Kept in `@almirant/shared` (instead of deriving from the Drizzle schema) so
 * that non-backend consumers (e.g. future frontend contract tests, agent job
 * payload validators) can import it without pulling in the database package.
 *
 * IMPORTANT: Keep this list in sync with `feedbackClusterStatusEnum` in
 * `backend/packages/database/src/schema/enums.ts`. Adding a value here without
 * a matching migration will cause Postgres enum mismatches at runtime.
 */
export const CLUSTER_STATUSES = [
  "open",
  "investigating",
  "fix_ready",
  "resolved",
  "regression",
  "dismissed",
  // `promoted` is retained as a legacy/deprecated value — existing rows with
  // this status must continue to be readable. Do NOT remove.
  "promoted",
] as const;

export type ClusterStatus = (typeof CLUSTER_STATUSES)[number];

/**
 * "Active" cluster statuses — the default set surfaced by the triage clusters
 * listing. Callers (admin UI, agents) that want the in-flight + actionable
 * set without the terminal `dismissed` bucket should use this array.
 *
 * Includes `promoted` for backward compatibility: clusters that were promoted
 * via the legacy flow still surface in the list until they are explicitly
 * dismissed by an admin.
 */
export const ACTIVE_CLUSTER_STATUSES: readonly ClusterStatus[] = [
  "open",
  "investigating",
  "fix_ready",
  "regression",
  "promoted",
] as const;

/**
 * Runtime type-guard for `ClusterStatus`. Useful when narrowing a free-form
 * string (e.g. a query-string value) to a valid enum member before passing it
 * to the repository.
 */
export const isClusterStatus = (value: string): value is ClusterStatus =>
  (CLUSTER_STATUSES as readonly string[]).includes(value);
