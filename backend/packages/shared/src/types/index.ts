// Shared domain types

export type WebhookTrigger = "tag_added";

export type WebhookStatus = "pending" | "success" | "failed";

export type ImportStatus = "pending" | "processing" | "completed" | "failed";

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type NightlyValidationProvider = "claude-code" | "codex" | "zipu" | "grok";

// Nightly validation configuration for project settings
export interface NightlyValidationSettings {
  enabled: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
  provider: NightlyValidationProvider;
}

// Agent action structured logs
export type AgentAction = 'validation' | 'validation_fail' | 'fix' | 'fix_fail' | 'implementation' | 'review';
export type AgentActionResult = 'pass' | 'fail' | 'partial';

export interface AgentActionMetadata {
  action: AgentAction;
  model: string;
  result: AgentActionResult;
  diagnosis?: string;
  durationMs?: number;
  tokensUsed?: number;
}

// API Response wrapper
export interface ApiResponseData<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: PaginationMeta;
}

// ──────────────────────────────────────────────
// Feedback Triage Inbox
// ──────────────────────────────────────────────

export interface ReviewInboxItem {
  id: string;
  title: string;
  content: string | null;
  authorName: string | null;
  aiCategory: string | null;
  aiConfidence: string | null;
  aiReasoning: string | null;
  suggestedClusterId: string | null;
  suggestedClusterTitle: string | null;
  suggestedTopicId: null;
  suggestedTopicTitle: null;
  createdAt: Date;
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
}

export interface TriageClusterTopicGroup {
  topic: string | null;
  clusters: TriageClusterSummary[];
}
