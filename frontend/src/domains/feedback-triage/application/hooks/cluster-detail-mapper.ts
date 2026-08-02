import type {
  TriageClusterDetail,
  ClusterTicketItem,
  ClusterTicketAuthor,
  ClusterStatus,
  FeedbackItemStatus,
  BugFixAttemptSummary,
  BugFixAttemptPrSummary,
  BugFixAttemptStatus,
  ClusterStatusEvent,
  ClusterPromotionSummary,
  ClusterSummary,
  ClusterLifecyclePhase,
  ClusterActiveAttemptSummary,
  ClusterIncidentContext,
  ClusterIncidentKind,
  ClusterLastChangeSummary,
} from "../../domain/types";
import type { ClusterTimelineEvent } from "../../domain/cluster-timeline";
import { deriveClusterSummary } from "../../domain/cluster-summary";
import type {
  WorkItemType,
  Priority,
  DebugContext,
  FeedbackWidgetSimpleMetadata,
} from "@/domains/feedback/domain/types";

type Nullable<T> = T | null | undefined;

interface RawCluster {
  id: string;
  title: string;
  summary: Nullable<string>;
  itemCount: number;
  status: ClusterStatus;
  suggestedType: Nullable<WorkItemType>;
  suggestedPriority: Nullable<Priority>;
  createdAt: string;
  updatedAt: string;
  // A-1876: regression counters. Optional on the raw shape so the mapper can
  // still build a sensible fallback summary when the backend is older and
  // does not include these columns in the detail payload.
  regressionCount?: Nullable<number>;
  lastRegressionAt?: Nullable<string>;
}

interface RawTicketAuthor {
  userId: Nullable<string>;
  name: Nullable<string>;
  email: Nullable<string>;
  avatarUrl: Nullable<string>;
  isAnonymous: boolean;
}

interface RawTicket {
  id: string;
  title: string;
  content: Nullable<string>;
  authorName: Nullable<string>;
  status: string;
  aiCategory: Nullable<string>;
  createdAt: string;
  metadata?: DebugContext | FeedbackWidgetSimpleMetadata | null;
  debugBundleId?: Nullable<string>;
  ticketNumber?: Nullable<string>;
  author?: Nullable<RawTicketAuthor>;
}

interface RawBugFixAttemptPr {
  state: Nullable<BugFixAttemptPrSummary["state"]>;
  reviewStatus: Nullable<BugFixAttemptPrSummary["reviewStatus"]>;
  ciStatus: Nullable<BugFixAttemptPrSummary["ciStatus"]>;
  mergedAt: Nullable<string>;
  closedAt: Nullable<string>;
}

interface RawBugFixAttempt {
  id: string;
  status: BugFixAttemptStatus;
  attemptNumber: number;
  rootCause: Nullable<string>;
  solutionProposed: Nullable<string>;
  fixPrUrl: Nullable<string>;
  fixPrNumber: Nullable<number>;
  createdAt: string;
  pr: Nullable<RawBugFixAttemptPr>;
  agentJobId?: Nullable<string>;
}

interface RawStatusHistoryEntry {
  id: string;
  fromStatus: Nullable<ClusterStatus>;
  toStatus: ClusterStatus;
  triggeredByKind: ClusterStatusEvent["triggeredByKind"];
  triggeredByUserId: Nullable<string>;
  triggeredByAttemptId: Nullable<string>;
  triggeredByAgentJobId: Nullable<string>;
  reason: Nullable<string>;
  metadata: Nullable<Record<string, unknown>>;
  changedAt: string;
}

interface RawWorkItem {
  id: string;
  taskId: Nullable<string>;
  title: string;
  type: WorkItemType;
  priority: Priority;
}

interface RawPromotion {
  promotion: {
    id: string;
    createdAt: string;
  };
  workItem: Nullable<RawWorkItem>;
}

// A-1876: raw shape of the backend-built `ClusterSummary`. Every field uses
// the same Nullable-friendly relaxation as the other raw interfaces so a
// partial/legacy payload still type-checks.
interface RawClusterActiveAttemptSummary {
  attemptId: string;
  attemptNumber: number;
  status: BugFixAttemptStatus;
  startedAt: string;
  prUrl: Nullable<string>;
  prNumber: Nullable<number>;
}

interface RawClusterIncidentContext {
  kind: ClusterIncidentKind;
  regressionCount: number;
  lastRegressionAt: Nullable<string>;
}

interface RawClusterLastChangeSummary {
  changedAt: string;
  fromStatus: Nullable<ClusterStatus>;
  toStatus: ClusterStatus;
  triggeredByKind: ClusterStatusEvent["triggeredByKind"];
  reason: Nullable<string>;
}

interface RawClusterSummary {
  lifecyclePhase: ClusterLifecyclePhase;
  status: ClusterStatus;
  activeAttempt: Nullable<RawClusterActiveAttemptSummary>;
  incident: RawClusterIncidentContext;
  lastChange: Nullable<RawClusterLastChangeSummary>;
}

export interface RawClusterDetailResponse {
  cluster: RawCluster;
  items?: RawTicket[];
  tickets?: RawTicket[];
  bugFixAttempts?: RawBugFixAttempt[];
  activeAttempt?: Nullable<RawBugFixAttempt>;
  statusHistory?: RawStatusHistoryEntry[];
  promotion?: Nullable<RawPromotion>;
  // A-F-434: backend now returns a pre-built chronological timeline. Optional
  // on the raw shape so older backends fall back to an empty array (the UI
  // stepper renders nothing rather than crashing).
  timelineEvents?: Nullable<ClusterTimelineEvent[]>;
  // A-1876: backend-built UX summary. Optional so older backends still
  // produce a valid `TriageClusterDetail` via the client-side fallback in
  // `deriveClusterSummary`.
  summary?: Nullable<RawClusterSummary>;
}

const mapAuthor = (
  raw: Nullable<RawTicketAuthor>,
  fallbackAuthorName: Nullable<string>
): ClusterTicketAuthor => {
  if (!raw) {
    // Backend rolled back to pre-A-1852 shape: synthesise an anonymous author
    // from whatever we can, defaulting to fully anonymous when nothing is set.
    return {
      userId: null,
      name: fallbackAuthorName ?? null,
      email: null,
      avatarUrl: null,
      isAnonymous: !fallbackAuthorName,
    };
  }
  return {
    userId: raw.userId ?? null,
    name: raw.name ?? fallbackAuthorName ?? null,
    email: raw.email ?? null,
    avatarUrl: raw.avatarUrl ?? null,
    isAnonymous: raw.isAnonymous,
  };
};

const mapTicket = (raw: RawTicket): ClusterTicketItem => ({
  id: raw.id,
  title: raw.title,
  content: raw.content ?? null,
  authorName: raw.authorName ?? null,
  status: raw.status as FeedbackItemStatus,
  aiCategory: raw.aiCategory ?? null,
  createdAt: raw.createdAt,
  metadata: raw.metadata ?? null,
  debugBundleId: raw.debugBundleId ?? null,
  ticketNumber: raw.ticketNumber ?? null,
  author: mapAuthor(raw.author, raw.authorName),
});

const mapPr = (raw: Nullable<RawBugFixAttemptPr>): BugFixAttemptPrSummary | null => {
  if (!raw) return null;
  return {
    state: raw.state ?? null,
    reviewStatus: raw.reviewStatus ?? null,
    ciStatus: raw.ciStatus ?? null,
    mergedAt: raw.mergedAt ?? null,
    closedAt: raw.closedAt ?? null,
  };
};

const mapAttempt = (raw: RawBugFixAttempt): BugFixAttemptSummary => ({
  id: raw.id,
  status: raw.status,
  attemptNumber: raw.attemptNumber,
  rootCause: raw.rootCause ?? null,
  solutionProposed: raw.solutionProposed ?? null,
  fixPrUrl: raw.fixPrUrl ?? null,
  fixPrNumber: raw.fixPrNumber ?? null,
  createdAt: raw.createdAt,
  pr: mapPr(raw.pr ?? null),
  agentJobId: raw.agentJobId ?? null,
});

const mapStatusEvent = (raw: RawStatusHistoryEntry): ClusterStatusEvent => ({
  id: raw.id,
  fromStatus: raw.fromStatus ?? null,
  toStatus: raw.toStatus,
  triggeredByKind: raw.triggeredByKind,
  triggeredByUserId: raw.triggeredByUserId ?? null,
  triggeredByAttemptId: raw.triggeredByAttemptId ?? null,
  triggeredByAgentJobId: raw.triggeredByAgentJobId ?? null,
  reason: raw.reason ?? null,
  metadata: raw.metadata ?? null,
  changedAt: raw.changedAt,
});

const mapActiveAttemptSummary = (
  raw: Nullable<RawClusterActiveAttemptSummary>,
): ClusterActiveAttemptSummary | null => {
  if (!raw) return null;
  return {
    attemptId: raw.attemptId,
    attemptNumber: raw.attemptNumber,
    status: raw.status,
    startedAt: raw.startedAt,
    prUrl: raw.prUrl ?? null,
    prNumber: raw.prNumber ?? null,
  };
};

const mapIncidentContext = (
  raw: RawClusterIncidentContext,
): ClusterIncidentContext => ({
  kind: raw.kind,
  regressionCount: raw.regressionCount ?? 0,
  lastRegressionAt: raw.lastRegressionAt ?? null,
});

const mapLastChange = (
  raw: Nullable<RawClusterLastChangeSummary>,
): ClusterLastChangeSummary | null => {
  if (!raw) return null;
  return {
    changedAt: raw.changedAt,
    fromStatus: raw.fromStatus ?? null,
    toStatus: raw.toStatus,
    triggeredByKind: raw.triggeredByKind,
    reason: raw.reason ?? null,
  };
};

/**
 * Map the backend-provided `summary` payload through. Returns null when the
 * backend response did not include one (older deployment) so the caller can
 * fall back to the client-side derivation.
 */
const mapSummary = (
  raw: Nullable<RawClusterSummary>,
): ClusterSummary | null => {
  if (!raw) return null;
  return {
    lifecyclePhase: raw.lifecyclePhase,
    status: raw.status,
    activeAttempt: mapActiveAttemptSummary(raw.activeAttempt),
    incident: mapIncidentContext(raw.incident),
    lastChange: mapLastChange(raw.lastChange),
  };
};

const mapPromotion = (
  raw: Nullable<RawPromotion>
): ClusterPromotionSummary | null => {
  if (!raw || !raw.workItem) return null;
  return {
    id: raw.promotion.id,
    workItemId: raw.workItem.id,
    workItemTaskId: raw.workItem.taskId ?? null,
    workItemTitle: raw.workItem.title,
    workItemType: raw.workItem.type,
    workItemPriority: raw.workItem.priority,
    createdAt: raw.promotion.createdAt,
  };
};

/**
 * Adapts the raw backend response from `GET /admin/feedback/feedback-clusters/:id`
 * (which matches `FeedbackClusterDetail` from @almirant/database) into the
 * frontend `TriageClusterDetail` shape consumed by the cluster detail modal.
 *
 * The backend returns `items`; the UI expects `tickets`. Also flattens the
 * nested `promotion.{ promotion, workItem }` into a single summary object.
 */
export const mapClusterDetailResponse = (
  raw: unknown
): TriageClusterDetail => {
  const r = raw as RawClusterDetailResponse;
  const rawTickets = r.tickets ?? r.items ?? [];
  const bugFixAttempts = (r.bugFixAttempts ?? []).map(mapAttempt);
  const activeAttempt = r.activeAttempt ? mapAttempt(r.activeAttempt) : null;
  const statusHistory = (r.statusHistory ?? []).map(mapStatusEvent);

  // A-1876: prefer the backend-built summary; otherwise derive a client-side
  // fallback from the same inputs the backend uses. The fallback exists so
  // the UI keeps rendering against older deployments that haven't shipped
  // the new field yet.
  const mappedSummary = mapSummary(r.summary ?? null);
  const summary: ClusterSummary =
    mappedSummary ??
    deriveClusterSummary({
      status: r.cluster.status,
      regressionCount: r.cluster.regressionCount ?? 0,
      lastRegressionAt: r.cluster.lastRegressionAt ?? null,
      activeAttempt,
      statusHistory,
    });

  return {
    cluster: {
      id: r.cluster.id,
      title: r.cluster.title,
      summary: r.cluster.summary ?? null,
      itemCount: r.cluster.itemCount,
      status: r.cluster.status,
      suggestedType: r.cluster.suggestedType ?? null,
      suggestedPriority: r.cluster.suggestedPriority ?? null,
      sampleItems: [],
      createdAt: r.cluster.createdAt,
      updatedAt: r.cluster.updatedAt,
    },
    tickets: rawTickets.map(mapTicket),
    bugFixAttempts,
    activeAttempt,
    statusHistory,
    promotion: mapPromotion(r.promotion ?? null),
    // A-F-434: pass through the backend-built timeline; default to [] when
    // absent so downstream selectors and the stepper component can rely on
    // the field being an array.
    timelineEvents: r.timelineEvents ?? [],
    summary,
  };
};
