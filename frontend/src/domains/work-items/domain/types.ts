import type { PaginationMeta } from "@/domains/shared/domain/types";
import type { BoardColumn, ColumnRole } from "@/domains/boards/domain/types";
import type { AgentProvider, RepoOption } from "@/domains/agents/domain/types";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import type { RunnerActionType } from "./column-actions";

// Work item type
export type WorkItemType = "epic" | "feature" | "story" | "task" | "idea";
export type ParentWorkItemType = "epic" | "feature" | "story";
export type LeafWorkItemType = "task" | "idea";

/** Type guard: returns true if the given type is a leaf type (task or idea) that requires a boardColumnId. */
export const isLeafType = (type: WorkItemType): type is LeafWorkItemType =>
  type === "task" || type === "idea";

/** Type guard: returns true if the given type is a parent type (epic, feature, story) with no boardColumnId. */
export const isParentType = (type: WorkItemType): type is ParentWorkItemType =>
  type === "epic" || type === "feature" || type === "story";

export type GroupByMode =
  | "none"
  | "parent"
  | "story"
  | "feature"
  | "epic"
  | "hierarchy"
  | "topmost";

// Sort options for kanban board (client-side sorting)
export type BoardSortBy = "manual" | "priority" | "createdAt" | "updatedAt" | "dueDate";

// Topmost-node projection: one entry per root ancestor branch
export interface TopmostNodeProjection {
  rootAncestor: AncestorInfo;
  leafItems: WorkItemWithContext[];
  totalCount: number;
  completedCount: number;
  columnDistribution: Record<string, number>;
}

// Priority
export type Priority = "low" | "medium" | "high" | "urgent";

export type TShirtSize = "XS" | "S" | "M" | "L" | "XL" | "XXL";


// Ancestor info for ancestry breadcrumbs
export interface AncestorInfo {
  id: string;
  title: string;
  type: WorkItemType;
  taskId: string | null;
}

// Documentation attached to a work item (stored in metadata.documentation).
export interface WorkItemDocumentation {
  summary: string;
  screenshots: string[];
  mermaidDiagrams?: string[];
  walkthroughUrls?: string[];      // URLs to walkthrough video attachments
  walkthroughViewport?: string;      // viewport used for the walkthrough
  generatedAt: string;
}

// Walkthrough video types (stored in metadata.walkthrough).
export type WalkthroughViewport = 'desktop' | 'mobile';
export type WalkthroughStatus = 'draft' | 'script_pending' | 'script_approved' | 'recording' | 'completed' | 'failed';

export interface WalkthroughScript {
  content: string;
  generatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  version: number;
}

export interface WalkthroughRecording {
  id: string;
  viewport: WalkthroughViewport;
  attachmentId?: string;
  attachmentUrl?: string;
  duration?: number;
  recordedAt: string;
  jobId?: string;
}

export interface WalkthroughMetadata {
  status: WalkthroughStatus;
  viewport: WalkthroughViewport;
  targetUrl?: string;
  scripts: WalkthroughScript[];
  currentScript?: WalkthroughScript;
  recordings: WalkthroughRecording[];
  initiatedAt: string;
  initiatedByJobId?: string;
  completedAt?: string;
}

// Reference to a GitHub pull request linked to a work item (stored in metadata.pullRequest).
export interface PullRequestRef {
  url: string;
  number: number;
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  branch: string;
}

// Reference to the release PR (long-lived, accumulates task PRs) that this work item ships in.
// Stored in metadata.releasePullRequest. Distinct from `pullRequest` (per-task PR).
export interface ReleasePullRequestRef {
  url: string;
  number: number;
  state: "open" | "closed" | "merged";
  branch: string;
  releaseNumber: number;
}

// Reference to a CI/CD status linked to a work item (stored in metadata.ciStatus).
export interface CiStatusRef {
  status: string;
  conclusion: string | null;
  url: string | null;
  workflowName: string | null;
  updatedAt: string;
}

// Checklist status for gate validation (move to Done blocking)
export interface ChecklistStatus {
  hasIncomplete: boolean;
  uncheckedItems: string[];
  totalChecked: number;
  totalItems: number;
}

interface ChecklistItem {
  text: string;
  checked: boolean;
}

/**
 * Parse a markdown string into checklist items.
 * Supports:
 *  - `- [ ] text`  /  `- [x] text`  (GFM task list)
 *  - `- text`  /  `* text`          (plain bullets → treated as unchecked)
 */
const parseChecklistItems = (markdown: string): ChecklistItem[] => {
  const lines = markdown.split("\n");
  const items: ChecklistItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // GFM task list
    const taskMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      items.push({ checked: taskMatch[1] !== " ", text: taskMatch[2] });
      continue;
    }

    // Plain bullet
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      items.push({ checked: false, text: bulletMatch[1] });
      continue;
    }
  }

  return items;
};

/**
 * Parse checklist status from work item metadata.
 * Reads `deployChecklist` (priority) or `userActions`.
 * Returns status indicating if there are incomplete items.
 */
export const parseChecklistStatus = (metadata: WorkItemMetadata | undefined | null): ChecklistStatus => {
  if (!metadata) {
    return { hasIncomplete: false, uncheckedItems: [], totalChecked: 0, totalItems: 0 };
  }

  // deployChecklist takes priority over userActions
  const checklistMarkdown = metadata.deployChecklist || metadata.userActions;

  if (!checklistMarkdown || typeof checklistMarkdown !== "string" || checklistMarkdown.trim() === "") {
    return { hasIncomplete: false, uncheckedItems: [], totalChecked: 0, totalItems: 0 };
  }

  const items = parseChecklistItems(checklistMarkdown);

  if (items.length === 0) {
    return { hasIncomplete: false, uncheckedItems: [], totalChecked: 0, totalItems: 0 };
  }

  const uncheckedItems = items.filter((item) => !item.checked).map((item) => item.text);
  const totalChecked = items.filter((item) => item.checked).length;

  return {
    hasIncomplete: uncheckedItems.length > 0,
    uncheckedItems,
    totalChecked,
    totalItems: items.length,
  };
};

// Metadata stored on work items and enriched by skills/agents.
// userActions is a markdown list of manual follow-up actions for the user.
export interface WorkItemMetadata extends Record<string, unknown> {
  definitionOfDone?: string;
  generatedPrompt?: string;
  managedBy?: string | string[];
  managedByAgents?: string[];
  aiReserved?: boolean;
  aiReservationProvider?: string;
  aiReservationModel?: string;
  aiReservationRunId?: string;
  aiReservationAt?: string;
  userActions?: string;
  deployChecklist?: string;
  validationChecks?: string;
  documentationNotes?: string;
  estimatedPoints?: number;
  dod_approved?: boolean;
  dod_incompleted?: boolean;
  dod_incompleted_count?: number;
  dod_human_action_required?: boolean;
  dod_human_action?: string;
  dod_human_action_reason?: string;
  dod_human_review_required?: boolean;
  dod_human_review_reason?: string;
  dod_auto_remediation_blocked?: boolean;
  /**
   * Structured replacement for `dod_human_action` (free text). When present
   * and the gate flags are set, the UI renders the DodHumanActionPanel
   * instead of the legacy alert. See `domain/dod-human-action.ts` for the
   * full shape.
   */
  dod_human_action_v2?: import("./dod-human-action").DodHumanActionV2;
  /** Audit fields stamped after the operator picks an option. */
  integration_human_action_applied_at?: string;
  integration_human_action_chosen_option_id?: string;
  integration_human_action_action_type?: string;
  integration_human_action_applied_by_user_id?: string;
  /** Set by enqueueDodRemediationFromIntegrationFailure (auto-remediable path). */
  integration_remediation_in_progress?: boolean;
  integration_remediation_started_at?: string;
  integration_remediation_failure_reason?: string;
  integration_remediation_source?: string;
  dod_external_validation_required?: boolean;
  dod_external_validation_tools?: string[] | string;
  dod_external_validation_reason?: string;
  dod_report?: string;
  dod_reviewed_at?: string;
  tested?: boolean;
  documentation?: WorkItemDocumentation;
  pullRequest?: PullRequestRef;
  releasePullRequest?: ReleasePullRequestRef;
  ciStatus?: CiStatusRef;
  previewUrl?: string;
  isBug?: boolean;
  walkthrough?: WalkthroughMetadata;
  lastAiError?: { message: string; type?: string; at: string; jobId?: string };
  planningSessionId?: string;
  planningModel?: string;
  planningProvider?: string;
  fromSeedIds?: string[];
}

// Assignee role
export type AssigneeRole = "responsible" | "collaborator" | "reviewer";

// Work item assignee (from junction table)
export interface WorkItemAssignee {
  id: string;
  workItemId: string;
  userId: string;
  role: AssigneeRole;
  assignedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

// Work item entity
export interface WorkItem {
  id: string;
  projectId: string | null;
  boardId: string;
  boardColumnId: string | null;
  parentId: string | null;
  type: WorkItemType;
  title: string;
  description: string | null;
  priority: Priority;
  assignee: string | null;
  position: number;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  metadata: WorkItemMetadata;
  isAiProcessing: boolean;
  taskId: string | null;
  createdByUserId: string | null;
  requestedByUserId: string | null;
  codingAgent: CodingAgent | null;
  aiModel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Work item with relations
export interface WorkItemWithRelations extends WorkItem {
  parent: { id: string; title: string; type: WorkItemType; taskId: string | null } | null;
  ancestors?: AncestorInfo[];
  children: { id: string; title: string; type: WorkItemType; priority: Priority }[];
  tags: { id: string; name: string; color: string }[];
  assignees: WorkItemAssignee[];
  createdBy: { id: string; name: string; image: string | null } | null;
  projectName: string;
  boardName: string;
  columnName: string | null;
  columnColor: string | null;
  columnIsDone?: boolean;
  childrenSummary?: ChildrenSummary;
}

export interface ChildUserActions {
  itemId: string;
  taskId: string | null;
  userActions: string;
  validationChecks?: string;
  documentationNotes?: string;
  isDeployChecklist?: boolean;
}

export interface ChildHumanActionRequirement {
  itemId: string;
  taskId: string | null;
  message: string;
  externalValidationRequired?: boolean;
  externalValidationTools?: string[];
}

export interface ChildrenSummary {
  totalLeafCount: number;
  doneCount: number;
  progressPercent: number;
  countPerColumn: Record<string, number>;
  leafIdsByColumn: Record<string, string[]>;
  childUserActions?: ChildUserActions[];
  childHumanActionRequirements?: ChildHumanActionRequirement[];
  aggregatedAssignees?: { id: string; name: string; email: string; image: string | null }[];
  totalEstimatedPoints?: number;
}

// Work item with board context (for Kanban view)
export interface WorkItemWithContext extends WorkItem {
  tags: { id: string; name: string; color: string }[];
  assignees: WorkItemAssignee[];
  childrenCount: number;
  parentTitle: string | null;
  parentType: WorkItemType | null;
  parentTaskId: string | null;
  createdBy: { id: string; name: string; image: string | null } | null;
  ancestors?: AncestorInfo[];
  projectName: string | null;
  projectColor: string | null;
  /** True when the item's column placement is computed from its children's progress (parent types). */
  isVirtualColumn: boolean;
  childrenSummary?: ChildrenSummary;
}

// Create work item request
export interface CreateWorkItemRequest {
  id?: string;
  projectId?: string | null;
  boardId: string;
  boardColumnId: string | null;
  parentId?: string;
  type: WorkItemType;
  title: string;
  description?: string;
  priority?: Priority;
  assignee?: string;
  position?: number;
  dueDate?: string;
  estimatedHours?: number;
  metadata?: WorkItemMetadata;
  tagIds?: string[];
}

// Update work item request
export interface UpdateWorkItemRequest {
  title?: string;
  description?: string | null;
  type?: WorkItemType;
  priority?: Priority;
  assignee?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | null;
  metadata?: WorkItemMetadata;
  tagIds?: string[];
  parentId?: string | null;
  projectId?: string | null;
  requestedByUserId?: string | null;
  codingAgent?: CodingAgent | null;
  aiModel?: string | null;
}

// Form data for creating/editing work items
export interface WorkItemFormData {
  title: string;
  type: WorkItemType;
  priority: Priority;
  description: string;
  assignee: string;
  dueDate?: Date;
  estimatedHours?: number;
  parentId?: string;
  tagIds: string[];
  definitionOfDone: string;
  projectId?: string;
  isBug?: boolean;
}

// Move work item request (Kanban drag-drop)
export interface MoveWorkItemRequest {
  boardColumnId: string;
  position: number;
}

// Change parent request
export interface ChangeParentRequest {
  parentId: string | null;
}

// Work item filters
export interface WorkItemFilters {
  search?: string;
  projectId?: string;
  boardId?: string;
  type?: WorkItemType;
  priority?: Priority;
  assignee?: string;
  parentId?: string;
}

// Work items grouped by column (for Kanban)
export interface WorkItemsByColumn {
  column: BoardColumn;
  items: WorkItemWithContext[];
  count: number;
}

// Hierarchy node
export interface WorkItemHierarchyNode {
  item: WorkItem;
  children: WorkItemHierarchyNode[];
}

// Bulk operations
export interface BulkMoveRequest {
  workItemIds: string[];
  boardColumnId: string;
}

export interface BulkChangePriorityRequest {
  workItemIds: string[];
  priority: Priority;
}

// Paginated response
export interface PaginatedWorkItemsResponse {
  items: WorkItemWithRelations[];
  meta: PaginationMeta;
}

// Component props
export interface WorkItemKanbanCardProps {
  id: string;
  title: string;
  type: WorkItemType;
  priority: Priority;
  assignee: string | null;
  tags: { id: string; name: string; color: string }[];
  childrenCount: number;
  onClick?: () => void;
}

export interface WorkItemColumnProps {
  column: BoardColumn;
  items: WorkItemWithContext[];
  onAddItem?: () => void;
  onItemClick?: (itemId: string) => void;
  /** Optional integration-batch context — rendered as a header slot on
   * columns with role "validating" / "release". When omitted, the slot is
   * hidden (boards without an attached repository, or non-dev boards). */
  integrationContext?: {
    projectId: string;
    repositoryId: string;
    boardId: string;
  };
}

export interface WorkItemFormProps {
  defaultValues?: Partial<CreateWorkItemRequest>;
  onSubmit: (data: CreateWorkItemRequest) => void;
  isSubmitting?: boolean;
  projectId?: string | null;
  boardId: string;
  columns: BoardColumn[];
}

export interface BoardFilterBarProps {
  filters: WorkItemFilters;
  onFiltersChange: (filters: WorkItemFilters) => void;
}

export interface WorkItemDetailProps {
  item: WorkItemWithRelations;
  onClose: () => void;
  onUpdate: (data: UpdateWorkItemRequest) => void;
  isUpdating?: boolean;
}

export interface WorkItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: import("react-hook-form").UseFormReturn<WorkItemFormData>;
  onSubmit: () => void;
  isPending: boolean;
  mode: "create" | "edit";
  // Work item ID (edit mode) - used to show agent thread
  workItemId?: string;
  allowedTypes?: WorkItemType[] | null;
  availableParents: { id: string; title: string; type: WorkItemType }[];
  availableTags: { id: string; name: string; color: string }[];
  availableProjects: { id: string; name: string }[];
  isLoadingParents?: boolean;
  isLoadingTags?: boolean;
  currentUserName?: string;
  onAssignToMe?: () => void;
  onCreateTag?: (name: string, color: string) => Promise<string>;
  onCreateParentOpen?: boolean;
  onCreateParentOpenChange?: (open: boolean) => void;
  activeBoardId?: string;
  children?: React.ReactNode;
  // Props for embedded parent creation form (uses same WorkItemFormData)
  parentForm?: import("react-hook-form").UseFormReturn<WorkItemFormData>;
  onParentSubmit?: () => void;
  isParentPending?: boolean;
  allowedParentTypes?: WorkItemType[];
  onParentAssignToMe?: () => void;
  // Watched values from parent form (passed from hook for proper reactivity)
  parentWatchedTitle?: string;
  parentWatchedType?: WorkItemType;
  // File drop support
  onFilesDropped?: (files: File[]) => void;
  // Form validity (passed through to WorkItemFormContent)
  isFormValid?: boolean;
  // AI formatting
  onAiFormatDescription?: () => void;
  isAiFormattingDescription?: boolean;
  onAiFormatDefinitionOfDone?: () => void;
  isAiFormattingDefinitionOfDone?: boolean;
  // Copy as prompt
  onCopyPrompt?: () => void;
  isCopyingPrompt?: boolean;
  showCopySuccess?: boolean;
  // Column/status change (edit mode only)
  boardColumns?: import("@/domains/boards/domain/types").BoardColumn[];
  currentColumnId?: string | null;
  onChangeColumn?: (columnId: string) => void;
  // Event history (edit mode only)
  historyContent?: React.ReactNode;
  // Image upload
  onImageUpload?: (file: File) => Promise<string>;
  // AI processing read-only mode
  isAiProcessing?: boolean;
  onStopAi?: () => void;
  // Assignee multi-select (team mode)
  availableAssignees?: { id: string; name: string; email: string; image?: string | null }[];
  hasActiveTeam?: boolean;
  selectedAssigneeIds?: string[];
  onSelectAssignee?: (userId: string) => void;
  onRemoveAssignee?: (userId: string) => void;
}

export interface WorkItemBoardContainerProps {
  activeBoardId: string;
  activeBoard: import("@/domains/boards/domain/types").BoardWithStats | undefined;
  area?: string;
}

// Work item dependencies
export interface WorkItemDependency {
  id: string;
  workItemId: string;
  blockedByWorkItemId: string;
  createdAt: string;
  blockedByWorkItem: {
    id: string;
    taskId: string | null;
    title: string;
    type: string;
    priority: string;
  };
}

export interface WorkItemDependent {
  id: string;
  workItemId: string;
  blockedByWorkItemId: string;
  createdAt: string;
  workItem: {
    id: string;
    taskId: string | null;
    title: string;
    type: string;
    priority: string;
  };
}

export interface WorkItemDependenciesResponse {
  dependencies: WorkItemDependency[];
  dependents: WorkItemDependent[];
}

export interface DependencySectionProps {
  workItemId: string;
  dependencies: WorkItemDependency[];
  dependents: WorkItemDependent[];
  isLoading: boolean;
  availableWorkItems: { id: string; taskId: string | null; title: string; type: WorkItemType }[];
  onAddDependency: (blockedByWorkItemId: string) => void;
  onRemoveDependency: (blockedByWorkItemId: string) => void;
  isAdding: boolean;
}

// Linked commit (from work_item_commits junction + github_commits data)
export interface LinkedCommit {
  id: string;
  workItemId: string;
  commitId: string;
  autoLinked: boolean;
  createdAt: string;
  commit: {
    id: string;
    sha: string;
    message: string;
    authorLogin: string | null;
    authorName: string | null;
    authorAvatarUrl: string | null;
    branch: string | null;
    additions: number;
    deletions: number;
    committedAt: string;
  };
}

export interface LinkedCommitsSectionProps {
  commits: LinkedCommit[];
  isLoading: boolean;
  onLinkCommit?: (commitId: string) => void;
  onUnlinkCommit?: (commitId: string) => void;
  isLinking?: boolean;
  availableCommits?: Array<{
    id: string;
    sha: string;
    message: string;
    authorLogin: string | null;
    branch: string | null;
    committedAt: string;
  }>;
  isSearchingCommits?: boolean;
}

// Linked documents (from document_work_items junction)
export interface LinkedDocument {
  id: string;
  title: string;
  categoryName: string | null;
  categoryColor: string | null;
  projectName: string | null;
  projectColor: string | null;
  updatedAt: string;
  linkedAt: string;
}

export interface LinkedDocumentsSectionProps {
  workItemId: string;
  documents: LinkedDocument[];
  isLoading: boolean;
  availableDocuments: { id: string; title: string; projectName: string | null }[];
  onLinkDocument: (documentId: string) => void;
  onUnlinkDocument: (documentId: string) => void;
  isLinking: boolean;
}

// Suggested documents (knowledge reuse suggestions)
export interface SuggestedDocument {
  id: string;
  title: string;
  contentPreview: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  createdAt: string;
  matchScore: number;
}

export interface SuggestedDocsSectionProps {
  suggestions: SuggestedDocument[];
  isLoading: boolean;
  onLinkDocument: (documentId: string) => void;
  isLinking: boolean;
}

// Work item attachments
export interface WorkItemAttachment {
  id: string;
  workItemId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedBy: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface AttachmentSectionProps {
  workItemId: string;
  attachments: WorkItemAttachment[];
  isLoading: boolean;
  onUpload: (file: File) => void;
  onDelete: (attachmentId: string) => void;
  isUploading: boolean;
}

// AI text formatting
export type AiFieldContext = "description" | "definitionOfDone" | "prompt" | "multiPrompt";

export interface AiFormatTextResponse {
  formattedText: string;
}

// Runner action props (generic AI action: implement, validate, fix, document)
export interface RunnerActionProps {
  /** Called when the user selects a provider for a runner action */
  onRunnerAction?: (workItemId: string, provider: AgentProvider, actionType: RunnerActionType, codingAgent?: CodingAgent, model?: string) => void;
  /** The workItemId currently being processed by a runner action */
  runnerActionPending?: string | null;
}

export interface WorkItemInfoPopupProps {
  title: string;
  description: string | null;
  definitionOfDone: string | null;
  children: React.ReactNode;
}

export interface SelectionActionBarProps {
  selectedCount: number;
  onGeneratePrompt: () => void;
  onClearSelection: () => void;
  isGenerating: boolean;
  columns: { id: string; name: string; color: string }[];
  onBulkMove: (columnId: string) => void;
  onBatchImplement: (provider: AgentProvider, codingAgent?: CodingAgent, model?: string) => void;
  isMoving: boolean;
  cliCommand: string | null;
  onCopyCliCommand: () => void;
  cliCommandCopied: boolean;
}

// Props for the sliding form panel
export interface SlidingFormPanelProps {
  activePanel: "main" | "parent";
  mainContent: React.ReactNode;
  parentContent: React.ReactNode;
}


// Backend-persisted board filter preferences (via useViewPreferences)
export interface BoardFilterPreferences {
  groupBy?: GroupByMode;
  priority?: string;
  assignee?: string;
  tagIds?: string;
  projectId?: string;
  isBug?: string;
}


// AI Session tracking
export interface AiSession {
  id: string;
  workItemId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: string;
  durationMs: number | null;
  sessionType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AiSessionSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCost: string;
  totalDurationMs: number;
  sessionCount: number;
}

export interface AiSessionsWithSummary {
  sessions: AiSession[];
  summary: AiSessionSummary;
}

// Batch context response (GET /work-items/:id/context)
export interface WorkItemContextResponse {
  dependencies: WorkItemDependenciesResponse;
  documents: LinkedDocument[];
  suggestedDocs: SuggestedDocument[];
  aiSessions: AiSessionsWithSummary;
  children: WorkItemWithRelations[];
  commits: LinkedCommit[];
}

export interface AiCostBadgeProps {
  summary: AiSessionSummary;
  sessions?: AiSession[];
  compact?: boolean;
}

export interface AiCostPopupProps {
  summary: AiSessionSummary;
  sessions?: AiSession[];
  children: React.ReactNode;
}

// Generate docs dialog
export interface GenerateDocsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItemTitle: string;
  onConfirm: () => void;
  onSkip: () => void;
  isGenerating: boolean;
}

export interface GenerateDocsResult {
  document: {
    id: string;
    title: string;
    projectId: string | null;
  };
}

// Group header (for "group by parent" view)
export interface GroupHeaderProps {
  parentId: string | null;
  parentTitle: string | null;
  parentType: WorkItemType | null;
  parentTaskId: string | null;
  ungroupedLabel?: string;
  itemCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  depth?: number;
  onParentClick?: (parentId: string) => void;
}

// Work item event history
export type WorkItemEventType =
  | "created"
  | "updated"
  | "moved"
  | "deleted"
  | "attachment_added"
  | "attachment_removed"
  | "ai_session"
  | "comment";

export type EventTriggeredBy = "user" | "system" | "claude-code" | "worker" | "websocket" | "api" | "nightly" | "mcp";

export interface WorkItemEvent {
  id: string;
  workItemId: string;
  eventType: WorkItemEventType;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  triggeredBy: EventTriggeredBy;
  triggeredByUserId: string | null;
  triggeredByUserName: string | null;
  triggeredByUserImage: string | null;
  triggeredByUserEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  // Present in children-events endpoint responses to identify which child the event belongs to
  taskId?: string | null;
}

export interface ParticipantActionSummary {
  eventType: WorkItemEventType;
  count: number;
  lastDate: string;
}

export interface WorkItemParticipant {
  userId: string;
  userName: string | null;
  userImage: string | null;
  lastAction: WorkItemEventType;
  lastActionDate: string;
  actions: ParticipantActionSummary[];
}

// AI participant types for rendering AI providers as avatars alongside human participants
export type AiParticipantProvider =
  | "openai"
  | "anthropic"
  | "zai"
  | "xai"
  | "grok"
  | "other";

export interface AiParticipant {
  kind: "ai";
  provider: AiParticipantProvider;
  label: string;
  isProcessing: boolean;
}

// Union type: human participants (with optional kind) or AI participants
export type ParticipantOrAi =
  | (WorkItemParticipant & { kind?: "human" })
  | AiParticipant;

export interface EventTimelineProps {
  events: WorkItemEvent[];
  isLoading: boolean;
  columnNameById?: Record<string, string>;
  projectNameById?: Record<string, string>;
}

// Saved views
export interface SavedView {
  id: string;
  userId: string;
  boardId: string;
  name: string;
  config: SavedViewConfig;
  createdAt: string;
  updatedAt: string;
}

export interface SavedViewConfig {
  groupBy?: string;
  filters?: Record<string, string>;
  projectId?: string;
  search?: string;
  typeFilter?: string;
  [key: string]: unknown;
}

export interface SavedViewsDropdownProps {
  views: SavedView[];
  isLoading: boolean;
  activeViewId: string | null;
  activeViewName: string | null;
  onSave: (name: string) => void;
  onUpdate: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onApply: (view: SavedView) => void;
  isSaving: boolean;
}

// Parent detail panel (slide-over to inspect a parent/ancestor)
export interface ParentDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: WorkItemWithRelations | null;
  isLoading: boolean;
  ancestors: AncestorInfo[];
  onNavigateToParent: (id: string) => void;
  children: WorkItemWithRelations[];
  isLoadingChildren: boolean;
  onNavigateToChild: (id: string) => void;
  canGoBack: boolean;
  onGoBack: () => void;
  activeTab: "details" | "history" | "sessions";
  onTabChange: (tab: "details" | "history" | "sessions") => void;
  childrenEvents: WorkItemEvent[];
  isLoadingChildrenEvents: boolean;
  ownEvents?: WorkItemEvent[];
  isLoadingOwnEvents?: boolean;
  showAll: boolean;
  onToggleShowAll: () => void;
  columnNameById?: Record<string, string>;
  projectNameById?: Record<string, string>;
  // Action handlers (optional - only provided when panel is open from board)
  onImplementWithAi?: (provider: AgentProvider, codingAgent?: CodingAgent, model?: string) => void;
  /** Generic runner action (validate, fix, document). Takes priority over onImplementWithAi when available. */
  onRunnerAction?: (provider: AgentProvider, actionType: RunnerActionType, codingAgent?: CodingAgent, model?: string) => void;
  /** Column role for the current item (used for role-based action resolution) */
  columnRole?: ColumnRole | null;
  onCopyPrompt?: () => void;
  onCopySavedPrompt?: () => void;
  onCopyCliCommand?: () => void;
  onCopyReviewCommand?: () => void;
  isCopyingPrompt?: boolean;
  showCopySuccess?: boolean;
  projectRepos?: RepoOption[];
  selectedRepoId?: string | null;
  onRepoSelect?: (repoId: string | null) => void;
  /** The project's default AI provider for highlighting in the provider selector. */
  defaultProvider?: AgentProvider;
  // Edit mode
  isEditing?: boolean;
  onToggleEdit?: () => void;
  editTitle?: string;
  onEditTitleChange?: (value: string) => void;
  editDescription?: string;
  onEditDescriptionChange?: (value: string) => void;
  editDefinitionOfDone?: string;
  onEditDefinitionOfDoneChange?: (value: string) => void;
  onSave?: () => void;
  isSaving?: boolean;
  onAiFormatDescription?: () => void;
  isAiFormattingDescription?: boolean;
  onAiFormatDefinitionOfDone?: () => void;
  isAiFormattingDefinitionOfDone?: boolean;
  defaultEditMode?: boolean;
  // Metadata editors (edit mode - immediate save)
  onTypeChange?: (type: WorkItemType) => void;
  onPriorityChange?: (priority: Priority) => void;
  boardColumns?: import("@/domains/boards/domain/types").BoardColumn[];
  currentColumnId?: string | null;
  onColumnChange?: (columnId: string) => void;
  availableAssignees?: { id: string; name: string; email: string; image?: string | null }[];
  hasActiveTeam?: boolean;
  selectedAssigneeIds?: string[];
  onSelectAssignee?: (userId: string) => void;
  onRemoveAssignee?: (userId: string) => void;
  dueDate?: Date | null;
  onDueDateChange?: (date: Date | null) => void;
  estimatedHours?: number | null;
  onEstimatedHoursChange?: (hours: number | null) => void;
  availableParents?: { id: string; title: string; type: WorkItemType }[];
  isLoadingParents?: boolean;
  onParentChange?: (parentId: string | undefined) => void;
  availableTags?: { id: string; name: string; color: string }[];
  isLoadingTags?: boolean;
  tagIds?: string[];
  onTagsChange?: (tagIds: string[]) => void;
  onCreateTag?: (name: string, color: string) => Promise<string>;
  isBug?: boolean;
  onBugToggle?: (isBug: boolean) => void;
  // Move child to a different column
  onMoveChild?: (childId: string, columnId: string) => void;
  // Execution origin data (rendered in History tab)
  executionOriginData?: {
    lastOrigin: ProvenanceLastOrigin | null;
    activeRun: ProvenanceActiveRun | null;
    sessionSummary: ProvenanceSessionSummary | null;
    isLoading: boolean;
  };
  // Advanced sections slot (rendered between DoD and Children)
  advancedSections?: React.ReactNode;
  // Sessions tab content slot
  sessionsContent?: React.ReactNode;
  // AI processing state
  isAiProcessing?: boolean;
  onStopAi?: () => void;
}

// Work item type filter tabs
export type WorkItemTypeFilter = WorkItemType | "all";

export interface WorkItemTypeTabsProps {
  activeType: WorkItemTypeFilter;
  onTypeChange: (type: WorkItemTypeFilter) => void;
  counts?: Partial<Record<WorkItemTypeFilter, number>>;
  /** Whether scrollable content extends beyond the left edge (shows left fade indicator) */
  canScrollLeft?: boolean;
  /** Whether scrollable content extends beyond the right edge (shows right fade indicator) */
  canScrollRight?: boolean;
}

// --- Provenance types ---

export type EventTriggeredByExpanded =
  | "user" | "system" | "claude-code"
  | "worker" | "websocket" | "api" | "nightly" | "mcp";

export interface ProvenanceLastOrigin {
  source: string | null;
  triggeredBy: string;
  userId: string | null;
  userName: string | null;
  userImage: string | null;
  processType: string | null;
  skillName: string | null;
  timestamp: string;
}

export interface ProvenanceActiveRun {
  jobId: string;
  jobType: string;
  status: string;
  provider: string;
  skillName: string | null;
  startedAt: string | null;
  createdByUserId: string | null;
  createdByUserName: string | null;
  worker: {
    workerId: string;
    hostname: string;
    status: string;
    lastHeartbeatAt: string | null;
  } | null;
}

export interface ProvenanceRecentJob {
  jobId: string;
  jobType: string;
  status: string;
  provider: string;
  skillName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface ProvenanceSessionSummary {
  totalSessions: number;
  totalTokens: number;
  totalEstimatedCost: string;
  totalDurationMs: number;
}

export interface ProvenanceLinks {
  activeJobId: string | null;
  latestSessionId: string | null;
  planningSessionId: string | null;
}

export interface WorkItemProvenance {
  lastOrigin: ProvenanceLastOrigin | null;
  activeRun: ProvenanceActiveRun | null;
  recentJobs: ProvenanceRecentJob[];
  sessionSummary: ProvenanceSessionSummary;
  links: ProvenanceLinks;
}

// Planning origin info (for work items created via AI planning sessions)
export type PlanningProvider = "anthropic" | "openai" | "zai" | "xai" | "other";

export interface PlanningOriginProps {
  hasPlanningOrigin: boolean;
  planningSessionId: string | undefined;
  planningModel: string | undefined;
  planningProvider: PlanningProvider | undefined;
  fromSeedIds: string[] | undefined;
  sessionTitle: string | undefined;
  sessionUrl: string | undefined;
  isLoadingSession: boolean;
}
