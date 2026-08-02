// Feedback Triage domain types
// This domain handles the review inbox, cluster management, and promotion workflows

import type {
  WorkItemType,
  Priority,
  DebugContext,
  FeedbackWidgetSimpleMetadata,
} from "@/domains/feedback/domain/types";
import type { ClusterTimelineEvent } from "@/domains/feedback-triage/domain/cluster-timeline";

// ─────────────────────────────────────────────────────────────────────────────
// Enums & Status Types
// ─────────────────────────────────────────────────────────────────────────────

export type TriageItemStatus = "pending" | "confirmed" | "dismissed" | "reassigned";

export type FeedbackItemStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "pending_validation"
  | "implementing"
  | "deployed"
  | "verified"
  | "cancelled";

export type ClusterStatus =
  | "open"
  | "investigating"
  | "fix_ready"
  | "resolved"
  | "regression"
  | "dismissed"
  | "promoted";

export const ACTIVE_CLUSTER_STATUSES: ClusterStatus[] = [
  "open",
  "investigating",
  "fix_ready",
  "regression",
];

export type TicketStatus = TriageItemStatus;

// ─────────────────────────────────────────────────────────────────────────────
// Inbox Item (Review Queue)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A feedback item in the review inbox waiting for triage action.
 * Includes AI suggestions for categorization and cluster assignment.
 */
export interface TriageInboxItem {
  id: string;
  title: string;
  content: string | null;
  authorName: string | null;
  aiCategory: string | null;
  aiConfidence: string | null;
  aiReasoning: string | null;
  suggestedClusterId: string | null;
  suggestedClusterTitle: string | null;
  suggestedTopicId: string | null;
  suggestedTopicTitle: string | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cluster Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sample item shown in cluster summary for quick preview.
 */
export interface ClusterSampleItem {
  id: string;
  title: string;
  authorName: string | null;
}

/**
 * Cluster summary shown in the triage clusters list.
 * Contains aggregated info and sample items for quick review.
 */
export interface TriageCluster {
  id: string;
  title: string;
  summary: string | null;
  itemCount: number;
  suggestedType: WorkItemType | null;
  suggestedPriority: Priority | null;
  sampleItems: ClusterSampleItem[];
  createdAt: string;
  status: ClusterStatus;
  updatedAt: string;
}

/**
 * Flat row used by the cluster data-table. The backend returns clusters
 * grouped by topic (`TriageClusterGroup`); the table needs a flat list with
 * the topic title denormalised onto each row for rendering/sorting.
 */
export type ClusterRow = TriageCluster & { topicTitle: string };

// ─────────────────────────────────────────────────────────────────────────────
// Cluster Actions & Transitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discriminator for user-initiated cluster status actions exposed in the UI.
 *
 * Each kind maps to a target `ClusterStatus`. Promotion is intentionally not
 * modeled here — it has its own dedicated flow (`promoteCluster`).
 */
export type ClusterActionKind =
  | "investigate"
  | "mark_fix_ready"
  | "resolve"
  | "reopen"
  | "mark_regression"
  | "dismiss"
  | "abort";

/**
 * Frontend mirror of the backend `CLUSTER_TRANSITIONS` matrix
 * (`backend/packages/database/src/repositories/feedback/feedback-cluster-repository.ts`).
 *
 * Must stay byte-for-byte in sync with the backend so that the UI hides/greys
 * transitions the API will reject with `INVALID_TRANSITION` (409).
 */
export const CLUSTER_STATUS_TRANSITIONS: Record<ClusterStatus, readonly ClusterStatus[]> = {
  open: ["investigating", "dismissed"],
  investigating: ["fix_ready", "open", "dismissed"],
  fix_ready: ["resolved", "open", "dismissed"],
  resolved: ["regression", "investigating"],
  regression: ["investigating", "dismissed"],
  dismissed: [],
  promoted: [],
};

/**
 * Map from a target `ClusterStatus` (as an allowed transition) to the UI
 * action kind surfaced on the cluster row. `promoted` is omitted on purpose
 * because promotion is handled outside this state-machine action set.
 */
const TARGET_STATUS_TO_ACTION: Partial<Record<ClusterStatus, ClusterActionKind>> = {
  investigating: "investigate",
  fix_ready: "mark_fix_ready",
  resolved: "resolve",
  open: "reopen",
  regression: "mark_regression",
  dismissed: "dismiss",
};

/**
 * Derive the set of action kinds available from a given current status,
 * based on `CLUSTER_STATUS_TRANSITIONS`. Preserves the matrix order so the UI
 * can render actions in a stable, predictable sequence.
 */
export const getAvailableActions = (status: ClusterStatus): ClusterActionKind[] => {
  const targets = CLUSTER_STATUS_TRANSITIONS[status] ?? [];
  const actions: ClusterActionKind[] = [];
  for (const target of targets) {
    const action = TARGET_STATUS_TO_ACTION[target];
    if (action) actions.push(action);
  }
  return actions;
};

/**
 * A-1932: maintenance actions that live outside the normal transition matrix.
 * Currently only exposes `abort` and only while the cluster is `investigating`.
 */
export const getMaintenanceActions = (
  cluster: Pick<ClusterRow, "status">
): ClusterActionKind[] => {
  if (cluster.status === "investigating") return ["abort"];
  return [];
};

/**
 * Resolved author information for a ticket. When a matching `user` row exists
 * (joined by email), the repository fills in `userId`, `name`, and
 * `avatarUrl` from the user table. When the feedback item is fully anonymous
 * (no author email on the row and no matching user) `isAnonymous` is true and
 * the UI should render an identicon; otherwise a Gravatar can be derived from
 * the email when `avatarUrl` is null.
 */
export interface ClusterTicketAuthor {
  userId: string | null;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  isAnonymous: boolean;
}

/**
 * A ticket/feedback item within a cluster with full detail.
 *
 * `metadata` holds the raw payload captured when the feedback was submitted:
 * - `DebugContext` for bug reports from the widget (screenshot, viewport,
 *   console errors, browser info).
 * - `FeedbackWidgetSimpleMetadata` for non-bug widget submissions.
 * - `null` for items without widget metadata (API ingest, CLI, etc.).
 *
 * `debugBundleId` mirrors `metadata.debugBundleId` when present so the UI can
 * deep-link to the incident bundle without re-parsing the metadata shape.
 *
 * `ticketNumber` is currently always null — there is no dedicated column yet;
 * the field is reserved so the UI can add a human-readable ticket reference
 * (e.g. `FB-1234`) once the schema catches up.
 */
export interface ClusterTicketItem {
  id: string;
  title: string;
  content: string | null;
  authorName: string | null;
  status: FeedbackItemStatus;
  aiCategory: string | null;
  createdAt: string;
  metadata: DebugContext | FeedbackWidgetSimpleMetadata | null;
  debugBundleId: string | null;
  ticketNumber: string | null;
  author: ClusterTicketAuthor;
}

/**
 * A status change event in the cluster's history.
 */
export interface ClusterStatusEvent {
  id: string;
  fromStatus: ClusterStatus | null;
  toStatus: ClusterStatus;
  triggeredByKind: "user" | "system" | "agent" | "webhook";
  triggeredByUserId: string | null;
  triggeredByAttemptId: string | null;
  triggeredByAgentJobId: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  changedAt: string;
}

/**
 * PR summary attached to a bug fix attempt.
 */
export interface BugFixAttemptPrSummary {
  state: "open" | "closed" | "merged" | null;
  reviewStatus:
    | "pending"
    | "approved"
    | "changes_requested"
    | "commented"
    | "dismissed"
    | null;
  ciStatus:
    | "pending"
    | "queued"
    | "in_progress"
    | "success"
    | "failure"
    | "cancelled"
    | "skipped"
    | "neutral"
    | null;
  mergedAt: string | null;
  closedAt: string | null;
}

export type BugFixAttemptStatus =
  | "analyzing"
  | "proposed"
  | "implementing"
  | "merged"
  | "failed";

/**
 * Summary of a bug fix attempt for a cluster.
 */
export interface BugFixAttemptSummary {
  id: string;
  status: BugFixAttemptStatus;
  attemptNumber: number;
  rootCause: string | null;
  solutionProposed: string | null;
  fixPrUrl: string | null;
  fixPrNumber: number | null;
  createdAt: string;
  pr: BugFixAttemptPrSummary | null;
  agentJobId: string | null;
}

/**
 * Summary of a cluster promotion to a work item.
 */
export interface ClusterPromotionSummary {
  id: string;
  workItemId: string;
  workItemTaskId: string | null;
  workItemTitle: string;
  workItemType: WorkItemType;
  workItemPriority: Priority;
  createdAt: string;
}

/**
 * UX-oriented grouping over the raw `ClusterStatus` enum. A-1876 keeps the
 * mapping 1:1 with the status values so the UI can pick the phase without a
 * lookup table, but the alias is kept separate so future UX grouping changes
 * don't require a DB enum migration.
 */
export type ClusterLifecyclePhase =
  | "open"
  | "investigating"
  | "fix_ready"
  | "resolved"
  | "regression"
  | "dismissed"
  | "promoted";

/**
 * Narrowed active-attempt snapshot surfaced by `ClusterSummary`. Mirrors the
 * backend `ClusterActiveAttemptSummary` shape 1:1.
 */
export interface ClusterActiveAttemptSummary {
  attemptId: string;
  attemptNumber: number;
  status: BugFixAttemptStatus;
  startedAt: string;
  prUrl: string | null;
  prNumber: number | null;
}

/**
 * "Is this the first time we see this issue, or a regression of a resolved
 * cluster?" — a discriminator the UI uses to pick copy, colour, and whether
 * to show the "previously resolved on …" hint.
 */
export type ClusterIncidentKind = "first_incident" | "regression";

/**
 * Incident context aggregated from `cluster.regressionCount` and
 * `cluster.lastRegressionAt`.
 */
export interface ClusterIncidentContext {
  kind: ClusterIncidentKind;
  regressionCount: number;
  lastRegressionAt: string | null;
}

/**
 * Snapshot of the last meaningful status change — the tail of the
 * chronologically-ordered `statusHistory`. Always reflects `cluster.status`
 * at read-time because `toStatus` is the cluster's current status.
 */
export interface ClusterLastChangeSummary {
  changedAt: string;
  fromStatus: ClusterStatus | null;
  toStatus: ClusterStatus;
  triggeredByKind: "user" | "system" | "agent" | "webhook";
  reason: string | null;
}

/**
 * Explicit UX summary attached to `TriageClusterDetail` (A-1876). The
 * frontend reads this directly instead of re-deriving lifecycle state from
 * `cluster.status`, `activeAttempt`, `bugFixAttempts`, and `timelineEvents`.
 *
 * The backend builds it via `buildClusterSummary`; when the response is
 * missing the field (older backend), the mapper falls back to a pure
 * client-side derivation in `domain/cluster-summary.ts`.
 */
export interface ClusterSummary {
  lifecyclePhase: ClusterLifecyclePhase;
  status: ClusterStatus;
  activeAttempt: ClusterActiveAttemptSummary | null;
  incident: ClusterIncidentContext;
  lastChange: ClusterLastChangeSummary | null;
}

/**
 * Full detail view of a triage cluster including tickets, attempts, and history.
 *
 * `timelineEvents` (A-F-434) is a chronologically-sorted flat list produced by
 * the backend `buildClusterTimeline` helper. The frontend stepper collapses
 * dense `ticket_created` runs into `ticket_burst` events at render time — the
 * backend never emits `ticket_burst` directly.
 *
 * `summary` (A-1876) is an explicit UX snapshot of lifecycle, active attempt,
 * incident context, and the last meaningful change. It is always present —
 * the mapper fills in a client-side fallback when the backend response omits
 * it, so downstream components can rely on it unconditionally.
 */
export interface TriageClusterDetail {
  cluster: TriageCluster & { status: ClusterStatus };
  tickets: ClusterTicketItem[];
  bugFixAttempts: BugFixAttemptSummary[];
  activeAttempt: BugFixAttemptSummary | null;
  statusHistory: ClusterStatusEvent[];
  promotion: ClusterPromotionSummary | null;
  timelineEvents: ClusterTimelineEvent[];
  summary: ClusterSummary;
}

/**
 * Clusters grouped by topic for hierarchical display.
 * Topic is null for uncategorized clusters.
 */
export interface TriageClusterGroup {
  topic: { id: string; title: string; slug: string; itemCount: number } | null;
  clusters: TriageCluster[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Promote Cluster Input/Response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for promoting a cluster to a work item.
 */
export interface PromoteClusterInput {
  workItemType: WorkItemType;
  title: string;
  description?: string;
  priority?: Priority;
  boardId: string;
  boardColumnId: string;
  parentId?: string;
  notes?: string;
  promotedBy?: string;
}

/**
 * Response from promoting a cluster to a work item.
 */
export interface PromoteClusterResponse {
  workItem: {
    id: string;
    title: string;
    taskId: string | null;
    type: WorkItemType;
    priority: Priority;
  };
  promotion: {
    id: string;
    feedbackItemId: string | null;
    workItemId: string;
    clusterId: string | null;
    createdAt: string;
  };
  linkedItemCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Cluster Input
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for manually creating a new cluster.
 */
export interface CreateClusterInput {
  title: string;
  summary?: string;
  topicId?: string;
  feedbackItemIds?: string[];
}

/**
 * Response from creating a cluster.
 */
export interface CreateClusterResponse {
  id: string;
  title: string;
  summary: string | null;
  itemCount: number;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Inputs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input for reassigning an inbox item to a different cluster.
 */
export interface ReassignToClusterInput {
  clusterId: string;
}

/**
 * Input for dismissing a feedback item.
 */
export interface DismissItemInput {
  reason?: string;
}

/**
 * Response from launching an investigation on a cluster.
 *
 * The launch endpoint no longer accepts any request body fields — the
 * backend derives the Almirant projectId from `getAlmirantProjectId()` on
 * the server (see A-1903). Callers invoke the API with just the clusterId.
 */
export interface LaunchInvestigationResponse {
  bugFixAttempt: BugFixAttemptSummary;
  agentJob: { id: string; status: string; jobType: string | null };
  cluster: TriageCluster & { status: ClusterStatus };
}

// ─────────────────────────────────────────────────────────────────────────────
// Launch Investigation Error Shapes (A-1874)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The anchor used by the retry budget counter on the backend.
 *
 * The backend currently counts attempts against the cluster; the
 * `feedback_item` branch is reserved for a future refactor that will reroute
 * some fix attempts through the originating feedback item.
 *
 * Mirrors `RetryBudgetAnchor` exported by the backend repository
 * (`backend/packages/database/src/repositories/feedback/feedback-cluster-repository.ts`).
 */
export type RetryBudgetAnchor = "cluster" | "feedback_item";

/**
 * Snapshot of the retry budget surfaced alongside a `max_attempts_reached`
 * launch error. The payload lets the UI render a precise, bilingual message
 * ("this cluster reached 3/3 attempts") and decide whether to offer a
 * drift-audit action.
 *
 * Mirrors `RetryBudgetStatus` from the backend repository.
 */
export interface RetryBudgetStatus {
  anchor: RetryBudgetAnchor;
  anchorId: string;
  currentCount: number;
  maxAttempts: number;
  isExhausted: boolean;
}

/**
 * Discriminator for the structured error payload returned by
 * `POST /feedback-clusters/:id/launch-investigation` when `success === false`.
 *
 * Each code corresponds to one branch of the backend union, so the UI can
 * render a tailored message without parsing free-form strings.
 */
export type LaunchInvestigationErrorCode =
  | "ACTIVE_ATTEMPT_EXISTS"
  | "MAX_ATTEMPTS_REACHED"
  | "INVALID_STATE"
  | "CLUSTER_EMPTY";

/**
 * Parsed body attached to a launch-investigation failure. All fields beyond
 * `code` are optional because different branches surface different context:
 *
 * - `ACTIVE_ATTEMPT_EXISTS`: `activeAttemptId` points to the in-flight attempt.
 * - `MAX_ATTEMPTS_REACHED`: `budget` contains the full retry-budget snapshot.
 * - `INVALID_STATE`: `currentStatus` + `allowedStatuses` explain the transition.
 * - `CLUSTER_EMPTY`: no extra context.
 */
export interface LaunchInvestigationErrorPayload {
  code: LaunchInvestigationErrorCode;
  budget?: RetryBudgetStatus;
  currentStatus?: string;
  allowedStatuses?: ClusterStatus[];
  activeAttemptId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Launch Investigation Shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-cluster outcome from the batch launch-investigation endpoint.
 *
 * When `success` is true, `agentJobId` and `attemptId` reference the launched
 * investigation. When `success` is false, `code` mirrors
 * `LaunchInvestigationErrorCode` (plus any future domain-error codes emitted
 * by the serial service) so the UI can aggregate failures by reason.
 */
export interface BatchLaunchInvestigationResult {
  clusterId: string;
  success: boolean;
  code?: string;
  agentJobId?: string;
  attemptId?: string;
}

/**
 * Response payload for `POST /admin/feedback-triage/clusters/batch-launch-investigation`.
 *
 * The endpoint always responds 200 with a per-cluster result list plus an
 * aggregate summary; partial failure is the normal case for a batch.
 */
export interface BatchLaunchInvestigationResponse {
  results: BatchLaunchInvestigationResult[];
  summary: {
    total: number;
    launched: number;
    skipped: number;
    codeCounts: Record<string, number>;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Abort Investigation Shapes (A-1930 backend / A-1932 frontend)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discriminator for the structured error payload returned by
 * `POST /feedback-clusters/:id/abort-investigation` when `success === false`.
 *
 * The abort endpoint only rejects one case — the cluster is not in
 * `investigating`, which surfaces as `INVALID_STATE`. Idempotent re-calls on
 * an already-aborted cluster return 200 with `code: "ALREADY_ABORTED"` in the
 * success payload, not an error.
 */
export type AbortInvestigationErrorCode = "INVALID_STATE";

/**
 * Parsed body attached to an abort-investigation failure.
 *
 * - `INVALID_STATE`: `currentStatus` + `allowedStatuses` explain the transition
 *   the UI attempted (abort is only allowed from `investigating`).
 */
export interface AbortInvestigationErrorPayload {
  code: AbortInvestigationErrorCode;
  currentStatus?: string;
  allowedStatuses?: string[];
}

/**
 * Success payload for the abort-investigation endpoint.
 *
 * - `bugFixAttempt`: the now-failed attempt snapshot. Omitted when the call
 *   was idempotent against an already-aborted cluster (no active attempt to
 *   mark failed).
 * - `cluster`: refreshed cluster row with `status === "open"`.
 * - `code`: `"ALREADY_ABORTED"` when the cluster was already out of the
 *   `investigating` state on a prior call. Absent on the first successful
 *   abort.
 */
export interface AbortInvestigationResponse {
  bugFixAttempt?: BugFixAttemptSummary;
  cluster: TriageCluster;
  code?: "ALREADY_ABORTED";
}

// ─────────────────────────────────────────────────────────────────────────────
// Dismiss Cluster Shapes (A-1911 backend / A-1912 frontend)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optional body for `POST /feedback-clusters/:id/dismiss`.
 *
 * `reason` is persisted in `cluster_status_history.reason` and surfaced in
 * the last-change audit line; it is capped at 2000 chars by the backend.
 */
export interface DismissClusterInput {
  reason?: string;
}

/**
 * Success payload for the dismiss-cluster endpoint.
 *
 * - `cluster`: the refreshed cluster row (status === "dismissed").
 * - `dismissedItemCount`: number of non-terminal feedback items that were
 *   cascade-cancelled. Zero when `alreadyDismissed` is true, or when every
 *   item was already in a terminal status (cancelled / verified / deployed).
 * - `alreadyDismissed`: true when the cluster was already dismissed before
 *   this call — the endpoint is idempotent and still returns 200.
 */
export interface DismissClusterResponse {
  cluster: TriageCluster & { status: ClusterStatus };
  dismissedItemCount: number;
  alreadyDismissed: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter parameters for the inbox list.
 */
export interface InboxFilters {
  status?: TriageItemStatus;
  aiDomain?: string;
  page?: number;
  limit?: number;
}

/**
 * Filter parameters for the clusters list.
 */
export interface ClustersFilters {
  statuses?: ClusterStatus[];
  showResolved?: boolean;
  minItemCount?: number;
  sortBy?: "itemCount" | "createdAt";
  page?: number;
  limit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paginated Responses
// ─────────────────────────────────────────────────────────────────────────────

export interface PaginatedInboxResponse {
  items: TriageInboxItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface PaginatedClustersResponse {
  groups: TriageClusterGroup[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
