import type { WorkItemType, Priority } from "./project-management.types";
import type { ClusterStatus } from "@almirant/shared";

// ──────────────────────────────────────────────
// Feedback
// ──────────────────────────────────────────────

export type FeedbackSourceType = "widget" | "api" | "telegram" | "email" | "manual";
export type FeedbackStatus = "new" | "triaged" | "in_progress" | "pending_validation" | "implementing" | "deployed" | "verified" | "cancelled";
export type FeedbackCategory = "bug" | "feature_request" | "improvement" | "question" | "praise" | "other";
export type FeedbackClusterStatus = "open" | "resolved" | "dismissed" | "promoted";

export interface PromoteFeedbackRequest {
  feedbackItemId: string;
  workItemType: WorkItemType;
  title: string;
  description?: string;
  priority?: Priority;
  boardId: string;
  boardColumnId: string | null;
  projectId: string;
  parentId?: string;
  notes?: string;
  promotedBy?: string;
}

export interface PromoteFeedbackResponse {
  promotion: {
    id: string;
    feedbackItemId: string;
    workItemId: string;
    createdAt: Date;
  };
  workItem: {
    id: string;
    title: string;
    taskId: string | null;
    type: WorkItemType;
  };
}

// ──────────────────────────────────────────────
// Cluster Promotion
// ──────────────────────────────────────────────

export interface PromoteClusterRequest {
  clusterId: string;
  workspaceId: string;
  boardId: string;
  boardColumnId?: string | null;
  workItemType?: WorkItemType;
  priority?: Priority;
  parentWorkItemId?: string;
  titleOverride?: string;
  notes?: string;
  promotedBy: string;
  createdByUserId?: string;
  projectId?: string | null;
}

export interface PromoteClusterResponse {
  workItem: {
    id: string;
    title: string;
    taskId: string | null;
    type: string;
  };
  promotion: {
    id: string;
    feedbackItemId: string;
    workItemId: string;
    createdAt: Date;
  };
  linkedItemCount: number;
}

// ──────────────────────────────────────────────
// Feedback Triage – Clusters grouped by topic (G2)
// ──────────────────────────────────────────────

export interface ClusterSampleItem {
  id: string;
  title: string;
  authorName: string | null;
}

export interface TriageClusterSummary {
  id: string;
  title: string;
  summary: string | null;
  itemCount: number;
  suggestedType: string | null;
  suggestedPriority: string | null;
  sampleItems: ClusterSampleItem[];
  createdAt: Date;
  // Cluster lifecycle fields surfaced in the triage listing so the admin UI
  // can render status chips and "last changed" timestamps without a follow-up
  // fetch. Added for A-1882 as part of the richer `GET /clusters` response.
  status: ClusterStatus;
  updatedAt: Date;
}

export interface TriageClusterTopicGroup {
  topic: string | null;
  clusters: TriageClusterSummary[];
}

// ──────────────────────────────────────────────
// Feedback Traceability
// ──────────────────────────────────────────────

export interface FeedbackTraceabilityResult {
  feedbackItem: {
    id: string;
    title: string;
    status: FeedbackStatus;
    category: FeedbackCategory;
    createdAt: Date;
  };
  promotion: {
    id: string;
    promotedBy: string | null;
    notes: string | null;
    createdAt: Date;
  } | null;
  workItem: {
    id: string;
    title: string;
    taskId: string | null;
    type: WorkItemType;
    priority: Priority;
    columnName: string;
  } | null;
}
