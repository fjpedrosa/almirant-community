/**
 * Cluster investigation context — shape injected into `AgentJobConfig.investigationContext`
 * when the backend prepares a fix/investigation job for a feedback cluster.
 *
 * This module is the single source of truth for:
 *   - The `ClusterInvestigationContext` interface consumed by the agent runner
 *   - The truncation/capacity constants used by the backend builder to keep
 *     the injected context within a sensible size budget.
 *
 * All array fields are REQUIRED — builders MUST emit an empty array (`[]`)
 * rather than `undefined` when a section has no data. This keeps downstream
 * consumers free from optional-chaining noise.
 *
 * NOTE: `InvestigationClusterStatusEvent` is named differently from the
 * `ClusterStatusEvent` used by the cluster timeline module (task A-1853) to
 * avoid a future export name collision.
 */

// ---------------------------------------------------------------------------
// Prior attempts
// ---------------------------------------------------------------------------

export interface PriorAttemptPrInfo {
  url: string;
  number: number | null;
  /** Truncated to MAX_PR_BODY_CHARS. */
  body: string | null;
  /** ISO date string. */
  mergedAt: string | null;
  additions: number | null;
  deletions: number | null;
}

export interface PriorAttemptInfo {
  id: string;
  attemptNumber: number;
  /** `bug_fix_attempt` status string. */
  status: string;
  /** ISO date string. */
  createdAt: string;
  rootCause: string | null;
  /** Truncated to MAX_SOLUTION_PROPOSED_CHARS. */
  solutionProposed: string | null;
  /** Capped at MAX_FILES_AFFECTED entries. */
  filesAffected: string[];
  pr: PriorAttemptPrInfo | null;
}

// ---------------------------------------------------------------------------
// Status history
// ---------------------------------------------------------------------------

/**
 * Status transition event recorded on the cluster.
 *
 * Named `InvestigationClusterStatusEvent` (instead of `ClusterStatusEvent`)
 * to avoid a collision with the timeline-oriented event type exported by
 * the cluster timeline module (task A-1853).
 */
export interface InvestigationClusterStatusEvent {
  fromStatus: string | null;
  toStatus: string;
  triggeredByKind: string;
  triggeredByUserId: string | null;
  triggeredByAttemptId: string | null;
  reason: string | null;
  /** ISO date string. */
  changedAt: string;
}

// ---------------------------------------------------------------------------
// Sample tickets
// ---------------------------------------------------------------------------

export interface SampleTicketDebugContext {
  screenshotUrl: string | null;
  browser: string | null;
  os: string | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  /** First 10 console error lines captured at ticket submission. */
  consoleErrors: string[];
}

export interface SampleTicketInfo {
  id: string;
  title: string;
  /** Truncated to MAX_CONSOLE_LOG_CHARS. */
  content: string | null;
  /** ISO date string. */
  createdAt: string;
  debugContext: SampleTicketDebugContext | null;
  pageUrl: string | null;
  userAgent: string | null;
}

// ---------------------------------------------------------------------------
// Error search
// ---------------------------------------------------------------------------

export interface ErrorSearchResultInfo {
  id: string;
  title: string;
  symptom: string | null;
  rootCause: string | null;
  fix: string | null;
  area: string | null;
  projectId: string | null;
}

/**
 * Status of the error-search sub-query performed while building the context.
 *
 * - `ok`       — search returned results (possibly empty)
 * - `timeout`  — search exceeded ERROR_SEARCH_TIMEOUT_MS
 * - `error`    — search threw an error
 * - `skipped`  — feature flag off, or no query could be derived
 */
export type ErrorSearchStatus = "ok" | "timeout" | "error" | "skipped";

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export interface ClusterInvestigationAggregates {
  totalTickets: number;
  totalAttempts: number;
  topPageUrls: Array<{ url: string; count: number }>;
  topUserAgents: Array<{ ua: string; count: number }>;
  topConsoleErrors: Array<{ error: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Truncation report
// ---------------------------------------------------------------------------

export interface ClusterInvestigationTruncationSection {
  kept: number;
  total: number;
}

export interface ClusterInvestigationTruncation {
  /** True when any section was reduced from its original size. */
  applied: boolean;
  /**
   * Map of section path → { kept, total }.
   *
   * Keys use dotted field paths, e.g.:
   *   - `"priorAttempts"`
   *   - `"sampleTickets.content"`
   *   - `"priorAttempts.pr.body"`
   */
  sections: Record<string, ClusterInvestigationTruncationSection>;
  contextSizeBytes: number;
}

// ---------------------------------------------------------------------------
// Top-level context
// ---------------------------------------------------------------------------

export interface ClusterInvestigationContext {
  priorAttempts: PriorAttemptInfo[];
  statusHistory: InvestigationClusterStatusEvent[];
  sampleTickets: SampleTicketInfo[];
  errorSearchResults: ErrorSearchResultInfo[];
  errorSearchStatus: ErrorSearchStatus;
  aggregates: ClusterInvestigationAggregates;
  truncation: ClusterInvestigationTruncation;
}

// ---------------------------------------------------------------------------
// Truncation / capacity constants
// ---------------------------------------------------------------------------

/** Maximum number of sample tickets embedded in the context. */
export const MAX_SAMPLE_TICKETS = 5;

/** Maximum number of prior fix attempts embedded in the context. */
export const MAX_PRIOR_ATTEMPTS = 5;

/** Maximum characters of ticket content / console logs kept per ticket. */
export const MAX_CONSOLE_LOG_CHARS = 1500;

/** Maximum characters of the `solutionProposed` field per prior attempt. */
export const MAX_SOLUTION_PROPOSED_CHARS = 2000;

/** Maximum characters of a PR body embedded in a prior attempt. */
export const MAX_PR_BODY_CHARS = 1500;

/** Maximum number of file paths retained per prior attempt. */
export const MAX_FILES_AFFECTED = 50;

/** Soft target for the total serialized context size (64 KiB). */
export const TARGET_CONTEXT_SIZE_BYTES = 64 * 1024;

/** Timeout applied to the error-search sub-query while building the context. */
export const ERROR_SEARCH_TIMEOUT_MS = 1500;

/** Maximum number of error-search results embedded in the context. */
export const ERROR_SEARCH_LIMIT = 5;
