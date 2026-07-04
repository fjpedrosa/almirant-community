import type { AgentJobStatus } from "./types";

/**
 * Statuses where the job is still doing work: its logs, output and status can
 * still change, so its queries must keep polling.
 */
export const ACTIVE_JOB_STATUSES: ReadonlySet<AgentJobStatus> = new Set([
  "queued",
  "running",
  "finalizing",
  "waiting_for_input",
  "paused",
]);

/**
 * Statuses where the job has stopped for good: its data is frozen, so polling
 * it is pure waste (WebSocket invalidation still covers any later change).
 */
export const TERMINAL_JOB_STATUSES: ReadonlySet<AgentJobStatus> = new Set([
  "completed",
  "incomplete",
  "failed",
  "cancelled",
]);

export const isActiveJobStatus = (
  status: AgentJobStatus | null | undefined,
): boolean => (status ? ACTIVE_JOB_STATUSES.has(status) : false);

export const isTerminalJobStatus = (
  status: AgentJobStatus | null | undefined,
): boolean => (status ? TERMINAL_JOB_STATUSES.has(status) : false);

/**
 * Refetch interval for a resource whose freshness only matters while its owning
 * job is active (e.g. a terminal job's logs never change again). Returns the
 * given interval while active, and `false` — "stop polling" — once inactive.
 */
export const activeJobPollInterval = (
  isActive: boolean,
  activeIntervalMs: number,
): number | false => (isActive ? activeIntervalMs : false);

/**
 * Refetch interval for a collection of jobs (a list, a per-work-item lookup):
 * poll quickly while at least one member is active, otherwise fall back to
 * `idleInterval`. Pass `false` as the idle value to stop entirely when
 * WebSocket invalidation already keeps the collection fresh.
 */
export const jobCollectionPollInterval = (
  statuses: readonly (AgentJobStatus | null | undefined)[],
  activeIntervalMs: number,
  idleInterval: number | false,
): number | false =>
  statuses.some(isActiveJobStatus) ? activeIntervalMs : idleInterval;
