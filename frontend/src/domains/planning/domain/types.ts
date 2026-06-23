import type { PaginationMeta } from "@/domains/shared/domain/types";
import type { Priority, WorkItemType } from "@/domains/work-items/domain/types";

// --- Enums ---

export type PlanningPhase =
  | "idle"
  | "enriching"
  | "booting"
  | "chatting"
  | "streaming"
  | "thinking"
  | "waiting_for_answer"
  | "reviewing"
  | "completed"
  | "paused"
  | "interrupted"
  | "resuming";

export type PlanningSessionStatus = "active" | "interrupted" | "completed" | "archived";

export type PlanningMessageRole = "user" | "assistant" | "system";

export type SeedStatus =
  | "draft"
  | "active"
  | "to_review"
  | "approved"
  | "archived"
  | "rejected";

export type SeedSource = "manual" | "feedback" | "ai_generated" | "import";

// Seeds reuse the shared Priority enum from work-items domain
export type SeedPriority = Priority;

// --- Planning Session ---

export interface PlanningSessionConfig {
  model?: string;
  provider?: string;
  systemPrompt?: string;
  temperature?: number;
  [key: string]: unknown;
}

export interface InterruptionContext {
  reason: string;
  lastPhase: string;
  pendingQuestionText?: string;
  pendingQuestionOptions?: string[];
  workItemsCreatedSoFar: number;
  seedsProcessedSoFar: number;
  lastJobId: string;
  interruptedAt: string;
}

export interface PlanningSessionResult {
  summary?: string;
  workItemsCreated?: number;
  seedsProcessed?: number;
  interruptionContext?: InterruptionContext;
  [key: string]: unknown;
}

export interface PlanningSession {
  id: string;
  organizationId: string;
  projectId: string | null;
  boardId: string | null;
  title: string;
  status: PlanningSessionStatus;
  config: PlanningSessionConfig | null;
  result: PlanningSessionResult | null;
  createdByUserId: string | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  estimatedCost: string | null;
  durationMs: number | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Computed meta (from repository joins)
  seedCount: number;
  workItemCount: number;
  createdByUserName: string | null;
  createdByUserImage: string | null;
  projectName: string | null;
  boardName: string | null;
}

export interface PlanningPendingInteraction {
  id: string;
  questionType: string;
  questionText: string;
  questionContext: Record<string, unknown> | null;
  agentJobId?: string;
  options?: string[] | null;
  expiresAt?: string | null;
  timeoutAction?: string | null;
}

export type PlanningSessionWithPendingInteraction = PlanningSession & {
  pendingInteraction?: PlanningPendingInteraction | null;
};

export interface PlanningMessage {
  id: string;
  sessionId: string;
  role: PlanningMessageRole;
  content: string;
  messageType: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  deliveryStatus?: "sending" | "queued" | "processing" | "delivered";
}

// --- Seed ---

export interface Seed {
  id: string;
  organizationId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: SeedStatus;
  source: SeedSource;
  priority: SeedPriority | null;
  ownerUserId: string | null;
  selectedForIdeation: boolean;
  metadata: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  maturityLevel: number;
}

export interface SeedTag {
  id: string;
  name: string;
  color: string | null;
}

export interface SeedFeedbackLink {
  id: string;
  feedbackItemId: string;
  title: string;
  status: string;
  category: string;
  createdAt: string;
}

export interface SeedWorkItemLink {
  id: string;
  workItemId: string;
  taskId: string | null;
  title: string;
  type: WorkItemType;
  linkType: string;
  createdAt: string;
}

export interface SeedWithRelations extends Seed {
  owner: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  } | null;
  createdBy: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  } | null;
  projectName: string | null;
  commentCount: number;
  lastComment: {
    userName: string | null;
    userImage: string | null;
    createdAt: string;
  } | null;
  feedbackLinks: SeedFeedbackLink[];
  workItemLinks: SeedWorkItemLink[];
  tags: SeedTag[];
}

export interface SeedComment {
  id: string;
  entityId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

export interface SeedEvent {
  id: string;
  entityId: string;
  eventType: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  triggeredBy: string;
  triggeredByUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  triggeredByUserName: string | null;
  triggeredByUserImage: string | null;
  triggeredByUserEmail: string | null;
}

// --- Filters ---

export interface PlanningSessionFilters {
  status?: PlanningSessionStatus;
  createdByUserId?: string;
  projectId?: string;
  page: number;
  limit: number;
}

export interface SeedFilters {
  status?: SeedStatus;
  statusGroup?: "active" | "finished";
  source?: SeedSource;
  priority?: SeedPriority;
  ownerUserId?: string;
  projectId?: string;
  search?: string;
  selectedForIdeation?: boolean;
  tagId?: string;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  page: number;
  limit: number;
}

// --- Request types ---

export interface CreatePlanningSessionRequest {
  title: string;
  projectId?: string;
  boardId?: string;
  config?: PlanningSessionConfig;
  seedIds?: string[];
}

export interface UpdatePlanningSessionRequest {
  title?: string;
  status?: PlanningSessionStatus;
  config?: PlanningSessionConfig;
}

export interface CompletePlanningSessionRequest {
  summary?: string;
  workItemsCreated?: number;
  seedsProcessed?: number;
}

export interface CreateSeedRequest {
  title: string;
  description?: string | null;
  status?: SeedStatus;
  source?: SeedSource;
  priority?: SeedPriority | null;
  projectId?: string | null;
  ownerUserId?: string | null;
  selectedForIdeation?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateSeedRequest {
  title?: string;
  description?: string | null;
  status?: SeedStatus;
  source?: SeedSource;
  priority?: SeedPriority | null;
  projectId?: string | null;
  ownerUserId?: string | null;
  selectedForIdeation?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PromoteSeedRequest {
  workItemType: Exclude<WorkItemType, "idea">;
  title: string;
  description?: string;
  priority?: Priority;
  boardId: string;
  boardColumnId?: string | null;
  projectId: string;
  parentId?: string;
  notes?: string;
  promotedBy?: string;
}

// --- Paginated responses ---

export interface PaginatedPlanningSessionsResponse {
  items: PlanningSession[];
  meta: PaginationMeta;
}

export interface PaginatedSeedsResponse {
  items: SeedWithRelations[];
  meta: PaginationMeta;
}

// --- Generated work item (from planning session output) ---

export interface GeneratedWorkItem {
  tempId: string;
  type: Exclude<WorkItemType, "idea">;
  title: string;
  description: string;
  priority: Priority;
  parentTempId?: string;
  fromSeedId?: string;
}

// --- Presentation props ---

export interface SeedChipProps {
  seed: SeedWithRelations;
  isSelected: boolean;
  onToggle: (id: string, selected: boolean) => void;
  onClick: (seed: SeedWithRelations) => void;
}

export interface SeedListProps {
  seeds: SeedWithRelations[];
  loading: boolean;
  onSeedClick: (seed: SeedWithRelations) => void;
  onToggleSelection: (id: string, selected: boolean) => void;
  selectedIds: Set<string>;
}

export interface SeedQuickAddProps {
  onSubmit: (data: { title: string; description?: string }) => void;
  isSubmitting: boolean;
}

export interface SeedSelectionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkAction: (action: "select_for_planning" | "deselect_from_planning") => void;
}

// --- Seed detail panel props ---

export interface SeedDetailPanelProps {
  seed: SeedWithRelations | null;
  isLoading: boolean;
  members: Array<{ id: string; name: string; email: string; image?: string | null }>;
  currentUserId: string | null;
  onStatusChange: (status: SeedStatus) => void;
  onOwnerChange: (ownerUserId: string | null) => void;
  onAddComment: (content: string) => void;
  isUpdatingStatus: boolean;
  isUpdatingOwner: boolean;
  isAddingComment: boolean;
  comments: SeedComment[];
  isLoadingComments: boolean;
  history: SeedEvent[];
  isLoadingHistory: boolean;
}
