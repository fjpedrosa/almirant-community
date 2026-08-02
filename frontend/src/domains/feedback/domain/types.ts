// Feedback domain types

// --- Admin Metrics ---

export interface FeedbackMetrics {
  inboxSize: number;
  itemsTriagedToday: number;
  autoAssignmentRate: number;
  avgTriageTime: number;
  itemsPromotedToday: number;
  bugFixesInProgress: number;
  topicsCount: number;
  clustersOpen: number;
}

export type FeedbackSourceType = "widget" | "api" | "telegram" | "email" | "manual";
export type FeedbackStatus = "new" | "triaged" | "in_progress" | "pending_validation" | "implementing" | "deployed" | "verified" | "cancelled";
export type FeedbackCategory = "bug" | "feature_request" | "improvement" | "question" | "praise" | "other";
export type FeedbackClusterStatus = "open" | "resolved" | "dismissed";

export type WorkItemType = "task" | "story" | "feature" | "epic";
export type Priority = "low" | "medium" | "high" | "urgent";

// --- Source ---

export interface FeedbackSource {
  id: string;
  name: string;
  type: FeedbackSourceType;
  publicKey: string;
  allowedDomains: string[];
  isActive: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// --- Item ---

export interface FeedbackItem {
  id: string;
  sourceId: string | null;
  clusterId: string | null;
  status: FeedbackStatus;
  category: FeedbackCategory;
  title: string;
  content: string | null;
  authorName: string | null;
  authorEmail: string | null;
  authorMeta: Record<string, unknown> | null;
  sentiment: string | null;
  // AI suggestion fields
  aiSuggestedType: WorkItemType | null;
  aiSuggestedTitle: string | null;
  aiSuggestedSummary: string | null;
  aiCategory: FeedbackCategory | null;
  aiConfidence: string | null;
  aiReasoning: string | null;
  metadata: Record<string, unknown>;
  promotedWorkItemId: string | null;
  createdAt: string;
  updatedAt: string;
  source?: { id: string; name: string; type: string } | null;
  cluster?: { id: string; title: string } | null;
}

// --- Cluster ---

export interface FeedbackCluster {
  id: string;
  title: string;
  summary: string | null;
  itemCount: number;
  status: FeedbackClusterStatus;
  suggestedType: WorkItemType | null;
  suggestedPriority: Priority | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// --- Promotion ---

export interface FeedbackPromotion {
  id: string;
  feedbackItemId: string;
  workItemId: string;
  promotedBy: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  feedbackItem?: { id: string; title: string; status: string } | null;
  workItem?: { id: string; title: string; taskId: string | null } | null;
}

// --- Promote request/response ---

export interface PromoteFeedbackRequest {
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

export interface PromoteFeedbackResponse {
  promotion: {
    id: string;
    feedbackItemId: string;
    workItemId: string;
    createdAt: string;
  };
  workItem: {
    id: string;
    title: string;
    taskId: string | null;
    type: WorkItemType;
  };
}

// --- Traceability ---

export type BugFixAttemptPrState = "open" | "closed" | "merged";
export type BugFixAttemptPrReviewStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "commented"
  | "dismissed";
export type BugFixAttemptPrCiStatus =
  | "pending"
  | "queued"
  | "in_progress"
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "neutral";

export interface FeedbackBugFixAttempt {
  id: string;
  attemptNumber: number;
  status: "analyzing" | "proposed" | "implementing" | "merged" | "failed";
  fixBranch: string | null;
  fixPrUrl: string | null;
  fixPrNumber: number | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  pr: {
    state: BugFixAttemptPrState;
    reviewStatus: BugFixAttemptPrReviewStatus;
    ciStatus: BugFixAttemptPrCiStatus;
    mergedAt: string | null;
    closedAt: string | null;
  } | null;
}

export interface FeedbackTraceabilityResult {
  feedbackItem: {
    id: string;
    title: string;
    status: FeedbackStatus;
    category: FeedbackCategory;
    createdAt: string;
  };
  promotion: {
    id: string;
    promotedBy: string | null;
    notes: string | null;
    createdAt: string;
  } | null;
  workItem: {
    id: string;
    title: string;
    taskId: string | null;
    type: WorkItemType;
    priority: Priority;
    columnName: string;
  } | null;
  bugFixAttempts: FeedbackBugFixAttempt[];
}

// --- Component Props ---

export interface PromoteFeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedbackItem: FeedbackItem;
  boardId: string;
  boardColumnId: string;
  onSubmit: (data: PromoteFeedbackRequest) => void;
  isPending: boolean;
}

export interface FeedbackOriginBadgeProps {
  feedbackItemId: string;
  feedbackTitle: string;
}

export interface PromotedWorkItemLinkProps {
  workItemId: string;
  workItemTitle: string;
  workItemTaskId: string | null;
}

export interface AiSuggestionsSectionProps {
  aiSuggestedType: WorkItemType | null;
  aiSuggestedTitle: string | null;
  aiSuggestedSummary: string | null;
  aiCategory: FeedbackCategory | null;
  aiConfidence: string | null;
  aiReasoning: string | null;
}

// --- Filters & Pagination ---

export interface FeedbackItemFilters {
  search?: string;
  status?: FeedbackStatus;
  category?: FeedbackCategory;
  sourceId?: string;
  page: number;
  limit: number;
}

export interface PaginatedFeedbackResponse {
  items: FeedbackItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// --- List Component Props ---

export interface FeedbackItemsListProps {
  items: FeedbackItem[];
  isLoading: boolean;
  onStatusChange?: (id: string, status: FeedbackStatus) => void;
  onTriage?: (id: string) => void;
  onDelete?: (id: string) => void;
  onItemClick?: (item: FeedbackItem) => void;
  /**
   * Selection state for bulk-triage UI. The selection column is only rendered
   * when `onToggleSelect` is provided (backwards-compat for consumers that do
   * not need selection). All selection logic lives in the container — this
   * component remains purely presentational.
   */
  selectedIds?: Set<string>;
  isSelected?: (id: string) => boolean;
  onToggleSelect?: (
    id: string,
    event?: { shiftKey?: boolean; metaKey?: boolean },
  ) => void;
  onSelectAll?: (ids: string[]) => void;
  onClearSelection?: () => void;
  /**
   * IDs of items eligible for selection (only rows with `status === "new"` can
   * be triaged). Used to compute the header select-all checkbox state.
   */
  selectableItemIds?: string[];
}

export interface FeedbackPaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}

export interface FeedbackFilterBarProps {
  filters: FeedbackItemFilters;
  hasActiveFilters: boolean;
  activeFilters: Array<{ key: keyof FeedbackItemFilters; label: string; value: string }>;
  onSearchChange: (search: string) => void;
  onStatusChange: (status: FeedbackStatus | undefined) => void;
  onCategoryChange: (category: FeedbackCategory | undefined) => void;
  onClearFilters: () => void;
  onRemoveFilter: (key: keyof FeedbackItemFilters) => void;
}

// --- Feedback Source CRUD ---

export interface CreateFeedbackSourceRequest {
  name: string;
  type: FeedbackSourceType;
  allowedDomains?: string[];
  config?: Record<string, unknown>;
}

export interface UpdateFeedbackSourceRequest {
  name?: string;
  type?: FeedbackSourceType;
  allowedDomains?: string[];
  isActive?: boolean;
  config?: Record<string, unknown>;
}

// --- Feedback Source Form ---

export interface FeedbackSourceFormData {
  name: string;
  type: FeedbackSourceType;
  allowedDomains: string;
  isActive: boolean;
}

// --- Feedback Source Component Props ---

export interface FeedbackSourcesListProps {
  sources: FeedbackSource[];
  isLoading: boolean;
  onEdit: (source: FeedbackSource) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onCreateClick: () => void;
  onRotateKey?: (id: string) => void;
  onShowIntegration?: (source: FeedbackSource) => void;
}

export interface IntegrationSnippetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: FeedbackSource | null;
}

export interface FeedbackSourceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: import("react-hook-form").UseFormReturn<FeedbackSourceFormData>;
  isPending: boolean;
  onSubmit: (data: FeedbackSourceFormData) => void;
  isEditing: boolean;
}

// --- Feedback Widget ---

export type FeedbackWidgetCategory = "bug" | "feature_request" | "improvement" | "other";

export interface FeedbackWidgetFormData {
  category: FeedbackWidgetCategory;
  message: string;
  email: string;
}

/**
 * Debug context captured when submitting feedback from the widget.
 * Includes browser environment, viewport dimensions, and recent console errors.
 *
 * Wire-shape source of truth: `@almirant/shared/debug-context.ts`. The
 * backend consumes the shared declaration when typing cluster-detail rows;
 * the frontend keeps this local declaration so it can narrow `traceSink` to
 * the dev-only `TraceSinkEntry[]` type without leaking the trace-sink module
 * into the shared package. Both declarations MUST stay structurally
 * compatible — when adding/removing a field, update both places.
 */
export interface DebugContext {
  timestamp: string;
  pageUrl: string;
  pathname: string;
  locale: string;
  userAgent: string;
  language: string;
  /** Parsed operating system name and version (e.g., "macOS 14.3", "Windows 11") */
  platform: string;
  /** Parsed browser name and version (e.g., "Chrome 120", "Safari 17.2") */
  browser: string;
  /** Parsed operating system (e.g., "macOS", "Windows 11", "Android 14") */
  os: string;
  /** CPU architecture (e.g., "arm64", "x86-64") */
  architecture: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  /**
   * Legacy screenshot URL pointing at `/api/uploads/images/<key>`. Kept for
   * backwards compatibility with feedback items created before A-1906. New
   * items set this to null and use `screenshotKey` instead.
   */
  screenshotUrl: string | null;
  /**
   * S3 object key for the feedback screenshot (`feedback-screenshots/<uuid>-<name>`).
   * Added in A-1906. Viewers (admins or the original author) resolve the
   * screenshot via `GET /api/feedback-items/:id/screenshot`, so the UI only
   * needs to know whether there is a screenshot — not the actual key.
   */
  screenshotKey?: string | null;
  consoleErrors: string[];
  source: "widget";
  /** Dev-only: ring-buffer of reducer transitions and WS frames (present when NEXT_PUBLIC_DEBUG_TRACE=1). */
  traceSink?: import("@/domains/debug/application/trace-sink").TraceSinkEntry[];
}

/**
 * Simple metadata for basic feedback submissions (no debug context).
 *
 * Wire-shape source of truth: `@almirant/shared/debug-context.ts`. Keep
 * structurally identical to the shared declaration.
 */
export interface FeedbackWidgetSimpleMetadata {
  pageUrl: string;
  locale: string;
  source: "widget";
}

export interface FeedbackWidgetSubmitPayload {
  category: FeedbackCategory;
  title: string;
  content: string;
  authorEmail?: string;
  authorName?: string;
  authorMeta?: Record<string, unknown>;
  status: "new";
  metadata: FeedbackWidgetSimpleMetadata | DebugContext;
}

export interface FeedbackFormProps {
  category: FeedbackWidgetCategory;
  message: string;
  email: string;
  isPending: boolean;
  isSuccess: boolean;
  isCapturingScreenshot: boolean;
  error: string | null;
  onCategoryChange: (category: FeedbackWidgetCategory) => void;
  onMessageChange: (message: string) => void;
  onEmailChange: (email: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export interface FeedbackWidgetProps {
  isOpen: boolean;
  isMobile: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isCapturingScreenshot: boolean;
  error: string | null;
  category: FeedbackWidgetCategory;
  message: string;
  email: string;
  onOpenChange: (open: boolean) => void;
  onCategoryChange: (category: FeedbackWidgetCategory) => void;
  onMessageChange: (message: string) => void;
  onEmailChange: (email: string) => void;
  onSubmit: () => void;
}

// ---------------------------------------------------------------------------
// Debug / Incident bundle types
// ---------------------------------------------------------------------------

export type DebugAnalysisStatus = "queued" | "running" | "completed" | "failed";

export interface DebugBundleMeta {
  bundleId?: string;
  status?: DebugAnalysisStatus;
  startedAt?: string;
}

export interface IncidentBundleTimelineEntry {
  t: number;
  source: "frontend-trace" | "session-event" | "job-log" | "error-memory" | "feedback";
  kind: string;
  actor: "user" | "backend" | "runner" | "ai" | "system";
  summary: string;
  refs: {
    jobId?: string;
    sessionId?: string;
    traceId?: string;
    sequenceNum?: number;
  };
  raw?: Record<string, unknown>;
}

export interface IncidentBundleResponse {
  bundle: {
    version: 1;
    feedback: {
      id: string;
      title: string;
      content: string | null;
      category: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    } | null;
    job: {
      id: string;
      status: string;
      jobType: string;
      skillName: string | null;
      config: Record<string, unknown>;
      errorMessage: string | null;
    } | null;
    sessionEvents: Array<{
      sequenceNum: number;
      kind: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }>;
    jobLogs: Array<{
      phase: string;
      eventType: string;
      level: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }>;
    frontendTrace: Array<{
      t: number;
      kind: string;
      label: string;
      traceId?: string;
      jobId?: string;
      sessionId?: string;
      meta?: Record<string, unknown>;
    }> | null;
    errorMemory: Array<{
      type: string;
      topicKey: string;
      title: string;
      content: string;
    }>;
  };
  timeline: {
    version: 1;
    bundleId: string;
    entries: IncidentBundleTimelineEntry[];
    truncated: boolean;
  };
}

// Batch triage (A-1919)
//
// Wire-format types for the batch-triage mutation used by the moderation page
// when an operator selects multiple `new` items and asks for a single-shot
// grouped triage job. Mirrors the HTTP contract of
// `POST /admin/feedback/feedback-items/batch-triage` (A-1918).

export interface BatchTriageRequest {
  feedbackItemIds: string[];
}

/**
 * Flat response shape matching the backend endpoint:
 * - enqueued=true  → a new feedback-triage-batch job was created; `jobId` is set.
 * - enqueued=false → an active batch already overlaps any of the requested ids;
 *                    `alreadyActiveJobId` identifies the in-flight job.
 * `itemCount` always mirrors the number of ids submitted.
 */
export interface BatchTriageResponse {
  enqueued: boolean;
  jobId?: string;
  alreadyActiveJobId?: string;
  itemCount: number;
}
