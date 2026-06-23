// AI Planning domain types
// Covers: chat messages, conversations, AI-generated work items, and component props.

import type React from "react";
import type { WorkItemType, Priority } from "@/domains/work-items/domain/types";
import type { SeedWithRelations } from "@/domains/planning/domain/types";
import type { StreamingBlock } from "@/domains/shared/domain/streaming-block-types";

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "system";

export interface UserMessageSeed {
  id: string;
  title: string;
  description?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  /** Distinguishes normal messages from thinking/stream messages. */
  messageType?: string;
  /** Seeds attached to this user message (shown as cards). */
  seeds?: UserMessageSeed[];
  /** Arbitrary metadata (tool call data, subagent info, etc.) */
  metadata?: Record<string, unknown>;
  /** Delivery status for user messages */
  deliveryStatus?: "sending" | "queued" | "processing" | "delivered";
}

// ---------------------------------------------------------------------------
// Generated work items (before user confirmation)
// ---------------------------------------------------------------------------

export interface GeneratedWorkItem {
  tempId: string;
  type: WorkItemType;
  title: string;
  description?: string;
  priority: Priority;
  parentTempId?: string;
}

export interface WorkItemPreview extends GeneratedWorkItem {
  isEditing: boolean;
  isRemoved: boolean;
}

// ---------------------------------------------------------------------------
// API request / response DTOs
// ---------------------------------------------------------------------------

export interface GenerateWorkItemsRequest {
  items: GeneratedWorkItem[];
  projectId: string;
  boardId: string;
  boardColumnId: string;
}

export interface GenerateWorkItemsResponse {
  createdIds: string[];
  errors: { tempId: string; error: string }[];
}

// ---------------------------------------------------------------------------
// Component props (presentational)
// ---------------------------------------------------------------------------

export interface ChatMessageProps {
  role: MessageRole;
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  /** When set to "thinking", renders a ThinkingBlock instead of the normal bubble. */
  messageType?: string;
  /** Whether the thinking block is collapsed (only relevant when messageType="thinking"). */
  isCollapsed?: boolean;
  /** Callback to toggle collapse state (only relevant when messageType="thinking"). */
  onToggleCollapse?: () => void;
  /** Seeds attached to this user message (shown as cards). */
  seeds?: UserMessageSeed[];
  /** Delivery status for user messages */
  deliveryStatus?: "sending" | "queued" | "processing" | "delivered";
  /** Whether this is the last message in the chat. */
  isLastMessage?: boolean;
  /** Whether the planning session has completed (for summary styling). */
  isSessionCompleted?: boolean;
  /** Label for the thinking header (e.g., "Thinking..." or i18n translation). */
  thinkingLabel?: string;
  /** Label for the reasoning header (e.g., "Reasoning" or i18n translation). */
  reasoningLabel?: string;
}

export interface ChatMessageListProps {
  messages: ChatMessage[];
  streamingContent?: string;
  isStreaming: boolean;
  /** Custom empty state rendered when there are no messages and not streaming. */
  emptyState?: React.ReactNode;
  /** Accumulated thinking content while the AI is in the "thinking" phase. */
  streamingThinkingContent?: string;
  /** Ordered streaming blocks — renders thinking/text/tool/file/bash/subagent in chronological order. */
  streamingBlocks?: StreamingBlock[];
  /** Persistent blocks from completed turns — rendered before current streamingBlocks. */
  completedTurnBlocks?: StreamingBlock[][];
  /** Ref to a sentinel div for auto-scrolling. Required — provided by the parent container. */
  bottomRef: React.RefObject<HTMLDivElement | null>;
  /** Callback ref for the scroll container (auto-scroll detection). */
  scrollRef?: React.Ref<HTMLDivElement>;
  /** Check if a thinking message is collapsed by its ID. */
  thinkingBlockIsCollapsed?: (id: string) => boolean;
  /** Toggle collapse state of a thinking message by its ID. */
  thinkingBlockToggleCollapse?: (id: string) => void;
  /** Total tokens consumed during the current streaming session. */
  totalTokens?: number;
  /** Latest real tool activity for the streaming indicator. */
  latestActivity?: string | null;
  /** Timestamp in ms when the current processing turn started. */
  processingStartedAt?: number | null;
  /** Whether to show the "scroll to bottom" button. */
  showScrollToBottom?: boolean;
  /** Callback to scroll to the bottom of the chat. */
  onScrollToBottom?: () => void;
  /** Whether the planning session has completed (for summary styling on last message). */
  isSessionCompleted?: boolean;
  /** User message waiting to be processed — rendered below Processing indicator. */
  pendingUserMessage?: { content: string; createdAt: string } | null;
  /** Callback when user submits feedback on an assistant message. */
  onFeedback?: (messageId: string, data: { content: string; sentiment: "positive" | "negative" }) => void;
}

export interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  isStreaming?: boolean;
  /** Optional toolbar rendered above the textarea area. */
  toolbar?: React.ReactNode;
  /** Controlled value. When provided, the component uses this instead of internal state. */
  value?: string;
  /** Controlled onChange. Required when `value` is provided. */
  onChange?: (value: string) => void;
  /** Controlled canSend flag. When provided, overrides internal derivation. */
  canSend?: boolean;
  /** Controlled send handler. When provided, used instead of the internal send-then-clear logic. */
  onSendAction?: () => void;
  /** Called when the user clicks the stop button during streaming. */
  onStop?: () => void;
  /** Called when the user confirms the kill action during streaming. */
  onKill?: () => void;
  /** Called when the user clicks the pause button during streaming. */
  onPause?: () => void;
  /** Whether the session is paused (enables input for instructions). */
  isPaused?: boolean;
  /** Controlled keyDown handler. When provided, used instead of internal Ctrl+Enter logic. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Voice recording is active. */
  isRecording?: boolean;
  /** Voice transcription is in progress. */
  isTranscribing?: boolean;
  /** Browser supports voice recording. */
  isVoiceSupported?: boolean;
  /** Start voice recording. */
  onStartRecording?: () => void;
  /** Stop voice recording. */
  onStopRecording?: () => void;
  /** Active media stream for audio visualization. */
  mediaStream?: MediaStream | null;
  /** When true, uses compact single-line layout on mobile. Defaults to true. */
  mobileCompact?: boolean;
  /** Hint shown inside the input box when the agent needs a follow-up response. */
  followUpHint?: string | null;
  /** ISO timestamp when the current interaction expires (for countdown timer). */
  expiresAt?: string | null;
}

export interface AttachedSeed {
  id: string;
  title: string;
}

export interface ChatInputToolbarProps {
  onSeedsClick: () => void;
  attachedSeeds?: AttachedSeed[];
  onRemoveSeed?: (seedId: string) => void;
}

export interface QuestionCardProps {
  questionText: string;
  options: string[];
  onSelectOption: (option: string) => void;
  onSubmitFreeText: (text: string) => void;
  isSubmitting: boolean;
  /** Ref for the free text input/textarea element. */
  inputRef?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /** Form submit handler. When provided, used instead of internal logic. */
  onFormSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
}

export interface ChatFullPanelProps {
  providerLabel: string;
  model: string;
  showModelBadge: boolean;
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  onSendMessage: (message: string) => void;
  showGeneration: boolean;
  /** Whether the session is interrupted. */
  isInterrupted?: boolean;
  /** Whether the session is resuming. */
  isResuming?: boolean;
  /** Reason why the session was interrupted. */
  interruptionReason?: string | null;
  /** Current step during session resumption. */
  resumeStep?: "queued" | "loading" | "restoring" | "ready" | null;
  /** Handler to resume the interrupted session. */
  onResume?: () => void;
  previewItems: WorkItemPreview[];
  columns: Array<{ id: string; name: string; color: string; isDone: boolean }>;
  activeColumnId: string;
  activeItemCount: number;
  isConfirming: boolean;
  onUpdateItem: (
    tempId: string,
    changes: Partial<GeneratedWorkItem>,
  ) => void;
  onRemoveItem: (tempId: string) => void;
  onColumnChange: (columnId: string) => void;
  onConfirmGeneration: () => void;
  onCancelGeneration: () => void;
  /** When true, generated items were already created during planning. */
  isAlreadyCreated?: boolean;
  /** Optional toolbar rendered above the chat input. */
  toolbar?: React.ReactNode;
  /** Custom empty state rendered when there are no messages. */
  emptyState?: React.ReactNode;
  /** Pending question from the planning session (interactive Q&A). */
  pendingQuestion?: {
    questionId: string;
    questionText: string;
    options: string[];
    questions?: Array<{ text: string; options: string[] }>;
    questionType?: "single_choice" | "multi_choice" | "free_text";
  } | null;
  /** Handler to answer a pending question by its ID. */
  onAnswerQuestion?: (questionId: string, answer: string) => void;
  /** Accumulated thinking content while the AI is in the "thinking" phase. */
  streamingThinkingContent?: string;
  /** Ordered streaming blocks — renders thinking/text/tool/file/bash/subagent in chronological order. */
  streamingBlocks?: StreamingBlock[];
  /** Persistent blocks from completed turns. */
  completedTurnBlocks?: StreamingBlock[][];
  /** Ref to a sentinel div for auto-scrolling. */
  bottomRef?: React.RefObject<HTMLDivElement | null>;
  /** Callback ref for the scroll container (auto-scroll detection). */
  scrollRef?: React.Ref<HTMLDivElement>;
  /** Check if a thinking message is collapsed by its ID. */
  thinkingBlockIsCollapsed?: (id: string) => boolean;
  /** Toggle collapse state of a thinking message by its ID. */
  thinkingBlockToggleCollapse?: (id: string) => void;
  /** Total tokens consumed during streaming (input + output). */
  totalTokens?: number;
  /** Latest real tool activity for the streaming indicator. */
  latestActivity?: string | null;
  /** Timestamp in ms when the current processing turn started. */
  processingStartedAt?: number | null;
  /** Called when the user clicks stop during streaming. */
  onStop?: () => void;
  /** Called when the user confirms the kill action during streaming. */
  onKill?: () => void;
  /** Called when the user clicks the pause button during streaming. */
  onPause?: () => void;
  /** Whether the session is paused (enables input for instructions). */
  isPaused?: boolean;
  /** Controlled chat input value. */
  chatInputValue?: string;
  /** Controlled chat input onChange. */
  chatInputOnChange?: (value: string) => void;
  /** Controlled chat input canSend flag. */
  chatInputCanSend?: boolean;
  /** Controlled chat input send handler. */
  chatInputOnSend?: () => void;
  /** Controlled chat input keyDown handler. */
  chatInputOnKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Ref for the question card free text input. */
  questionInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Form submit handler for the question card. */
  questionOnFormSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Whether to show the "scroll to bottom" button. */
  showScrollToBottom?: boolean;
  /** Callback to scroll to the bottom of the chat. */
  onScrollToBottom?: () => void;
  /** Whether the planning session has completed (hides chat input). */
  isSessionCompleted?: boolean;
  /** Work items created during this planning session. */
  completedWorkItems?: Array<{ tempId: string; type: string; title: string }>;
  /** Total count of work items created. */
  completedWorkItemCount?: number;
  /** User message waiting to be processed — shown below Processing indicator. */
  pendingUserMessage?: { content: string; createdAt: string } | null;
  /** Voice recording is active. */
  isRecording?: boolean;
  /** Voice transcription is in progress. */
  isTranscribing?: boolean;
  /** Browser supports voice recording. */
  isVoiceSupported?: boolean;
  /** Start voice recording. */
  onStartRecording?: () => void;
  /** Stop voice recording. */
  onStopRecording?: () => void;
  /** Active media stream for audio visualization. */
  mediaStream?: MediaStream | null;
  /** Ref callback for routing voice transcripts to the question wizard textarea. */
  wizardTranscriptRef?: React.MutableRefObject<((text: string) => void) | null>;
  /** Whether the session ended without success (idle timeout, killed, etc). */
  isSessionEnded?: boolean;
  /** Reason why the session ended (e.g. "no_items_created", "idle_timeout", "killed_by_user"). */
  sessionEndReason?: string | null;
  /** Handler to restart the ended session. */
  onRestartSession?: () => void;
  /** Handler to start a brand-new session (discard current). */
  onNewSession?: () => void;
  /** Whether a restart is in progress. */
  isRestarting?: boolean;
  /** Whether the agent is waiting for a follow-up response from the user. */
  pendingFollowUp?: boolean;
  /** Contextual prompt text for the follow-up (e.g., "How would you like to continue?"). */
  followUpPrompt?: string | null;
  /** ISO timestamp when the current interaction expires (for countdown timer). */
  expiresAt?: string | null;
  /** Callback when user submits feedback on an assistant message. */
  onFeedback?: (messageId: string, data: { content: string; sentiment: "positive" | "negative" }) => void;
}

export interface WorkItemPreviewTreeProps {
  items: WorkItemPreview[];
  onUpdateItem: (
    tempId: string,
    changes: Partial<GeneratedWorkItem>,
  ) => void;
  onRemoveItem: (tempId: string) => void;
  /** When true, hides edit/delete controls (items already exist in the board). */
  readOnly?: boolean;
}

export interface GenerationConfirmPanelProps {
  items: WorkItemPreview[];
  onUpdateItem: (
    tempId: string,
    changes: Partial<GeneratedWorkItem>,
  ) => void;
  onRemoveItem: (tempId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming: boolean;
  itemCount: number;
  /** When true, items were already created during planning — show review mode. */
  isAlreadyCreated?: boolean;
}

export interface ModelSelectorProps {
  providerKeys: { id: string; name: string; provider: string }[];
  selectedKeyId: string;
  selectedModel: string;
  availableModels: string[];
  hasKeys: boolean;
  isLoading: boolean;
  onKeyChange: (keyId: string) => void;
  onModelChange: (model: string) => void;
  /** When true, renders a compact chip that opens a Popover with the full selectors. */
  compact?: boolean;
}

export interface ModelFloatingSelectorProps {
  providerKeys: { id: string; name: string; provider: string }[];
  selectedKeyId: string;
  selectedModel: string;
  availableModels: string[];
  hasKeys: boolean;
  isLoading: boolean;
  onKeyChange: (keyId: string) => void;
  onModelChange: (model: string) => void;
  isSessionActive: boolean;
  isSessionCompleted?: boolean;
  activeModelLabel?: string;
  isSidebarOpen?: boolean;
  selectedCodingAgent?: import("@/domains/agents/domain/coding-agent-compatibility").CodingAgent;
  onCodingAgentChange?: (agent: import("@/domains/agents/domain/coding-agent-compatibility").CodingAgent) => void;
}

export interface ActiveModelBadgeProps {
  providerLabel: string;
  model: string;
  visible: boolean;
}

// ---------------------------------------------------------------------------
// Plan selector (project + board picker before entering the planning session)
// ---------------------------------------------------------------------------

export interface PlanSelectorProject {
  id: string;
  name: string;
}

export interface PlanSelectorBoard {
  id: string;
  name: string;
  totalItems: number;
}

// ---------------------------------------------------------------------------
// Inline project + board selector (local state only, no navigation)
// ---------------------------------------------------------------------------

export interface ProjectBoardSelectorState {
  projects: PlanSelectorProject[];
  boards: PlanSelectorBoard[];
  selectedProjectId: string;
  selectedBoardId: string;
  isLoadingProjects: boolean;
  isLoadingBoards: boolean;
  isReady: boolean;
  onProjectChange: (projectId: string) => void;
  onBoardChange: (boardId: string) => void;
}

// ---------------------------------------------------------------------------
// Seeds panel state (return type of useSeedsPanelState hook)
// ---------------------------------------------------------------------------

export interface SeedsPanelState {
  // Data
  seeds: SeedWithRelations[];
  filteredSeeds: SeedWithRelations[];
  isLoading: boolean;
  totalCount: number;
  filteredCount: number;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Selection
  selectedIds: Set<string>;
  selectedCount: number;
  handleToggleSelection: (id: string, selected: boolean) => void;
  handleSelectAll: () => void;
  handleDeselectAll: () => void;

  // Quick add
  handleQuickAdd: (data: { title: string; description?: string }) => void;
  isCreating: boolean;

  // Bulk actions
  handleBulkAction: (
    action: "select_for_planning" | "deselect_from_planning",
  ) => void;
  isBulkUpdating: boolean;
}

// ---------------------------------------------------------------------------
// Plan chat header props (compact header for /plan page)
// ---------------------------------------------------------------------------

export interface PlanChatHeaderProps {
  modelSelectorProps: ModelSelectorProps;
  isSessionActive: boolean;
  activeProjectName?: string;
  activeModelLabel?: string;
  onNewSession: () => void;
}

// ---------------------------------------------------------------------------
// Empty session state props (shown when no planning session is active)
// ---------------------------------------------------------------------------

export interface EmptySessionStateProps {
  onStartSession: () => void;
  isStarting?: boolean;
  projects: Array<{ id: string; name: string }>;
  selectedProjectId: string;
  isLoadingProjects: boolean;
  onProjectChange: (projectId: string) => void;
}

// ---------------------------------------------------------------------------
// Welcome screen props (warm welcome during boot)
// ---------------------------------------------------------------------------

export type BootPhase = "connecting" | "preparing" | "almost_ready";

export interface WelcomeScreenProps {
  welcomeMessage: string | null;
  isLoadingWelcome: boolean;
  bootPhase: BootPhase;
  suggestions: string[];
  onSuggestionClick: (suggestion: string) => void;
}

// ---------------------------------------------------------------------------
// Planning page header props (presentational)
// ---------------------------------------------------------------------------

export interface PlanningPageHeaderProps {
  projects: Array<{ id: string; name: string }>;
  boards: Array<{ id: string; name: string }>;
  selectedProjectId: string;
  selectedBoardId: string;
  isLoadingProjects: boolean;
  isLoadingBoards: boolean;
  onProjectChange: (projectId: string) => void;
  onBoardChange: (boardId: string) => void;
  modelSelectorProps: ModelSelectorProps;
  isChatOpen: boolean;
  onToggleChat: () => void;
  onNewConversation: () => void;
}

// ---------------------------------------------------------------------------
// Seeds panel props (presentational)
// ---------------------------------------------------------------------------

export interface SeedsPanelProps {
  seeds: SeedWithRelations[];
  loading: boolean;
  selectedIds: Set<string>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSeedClick: (seed: SeedWithRelations) => void;
  onToggleSelection: (id: string, selected: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkAction: (
    action: "select_for_planning" | "deselect_from_planning",
  ) => void;
  onQuickAdd: (data: { title: string; description?: string }) => void;
  isSubmittingQuickAdd: boolean;
}

// ---------------------------------------------------------------------------
// Chat panel props (presentational)
// ---------------------------------------------------------------------------

export interface ChatPanelProps {
  providerLabel: string;
  model: string;
  showModelBadge: boolean;
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  onSendMessage: (message: string) => void;
  showGeneration: boolean;
  previewItems: WorkItemPreview[];
  columns: Array<{ id: string; name: string; color: string; isDone: boolean }>;
  activeColumnId: string;
  activeItemCount: number;
  isConfirming: boolean;
  onUpdateItem: (
    tempId: string,
    changes: Partial<GeneratedWorkItem>,
  ) => void;
  onRemoveItem: (tempId: string) => void;
  onColumnChange: (columnId: string) => void;
  onConfirmGeneration: () => void;
  onCancelGeneration: () => void;
  /** When true, generated items were already created during planning. */
  isAlreadyCreated?: boolean;
}

// ---------------------------------------------------------------------------
// Side panel tab type
// ---------------------------------------------------------------------------

export type SidePanelTab = "chat" | "detail";

// ---------------------------------------------------------------------------
// Member type (for owner selector)
// ---------------------------------------------------------------------------

export interface PlanningMember {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

// ---------------------------------------------------------------------------
// Session sidebar (ChatGPT-style left sidebar for planning session history)
// ---------------------------------------------------------------------------

export interface SessionSidebarItemProps {
  id: string;
  title: string;
  relativeDate: string;
  creatorName: string | null;
  creatorImage: string | null;
  isActive: boolean;
  canResume: boolean;
  status: string;
  onClick: () => void;
  onDelete: () => void;
  onResume: () => void;
}

export interface SessionSidebarGroupProps {
  label: string;
  children: React.ReactNode;
}

export interface SessionSidebarProps {
  isOpen: boolean;
  groups: Array<{
    label: string;
    sessions: Array<{
      id: string;
      title: string;
      relativeDate: string;
      creatorName: string | null;
      creatorImage: string | null;
      status: string;
      createdAt: string;
    }>;
  }>;
  activeSessionId: string | null;
  onToggle: () => void;
  onSessionClick: (id: string) => void;
  onSessionDelete: (id: string) => void;
  onSessionResume: (id: string) => void;
  onNewSession: () => void;
  onSearchOpen: () => void;
  /** When true, sidebar fills its container width instead of fixed w-64. */
  fullWidth?: boolean;
}

export interface SessionSearchDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  groups: SessionSidebarProps["groups"];
  onSessionClick: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Seed import dialog (inject seeds as context in the chat)
// ---------------------------------------------------------------------------

export interface SeedImportResult {
  seeds: SeedWithRelations[];
  contextPrefix: string;
}

export interface SeedImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  seeds: SeedWithRelations[];
  isLoading: boolean;
  selectedIds: Set<string>;
  selectedCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onImport: () => void;
  // Dynamic filters
  filtersConfig: import("@/domains/shared/domain/filter-types").DynamicFiltersConfig;
  dynamicFilters: {
    appliedFilters: import("@/domains/shared/domain/filter-types").AppliedFilter[];
    availableFilters: import("@/domains/shared/domain/filter-types").FilterDefinition[];
    addFilter: (filter: import("@/domains/shared/domain/filter-types").FilterDefinition, operator: import("@/domains/shared/domain/filter-types").FilterOperator, value: string | string[]) => void;
    removeFilter: (filterId: string) => void;
    updateFilter: (filterId: string, value: string | string[]) => void;
    clearFilters: () => void;
  };
  hasActiveFilters: boolean;
}

// ---------------------------------------------------------------------------
// Voice recorder types
// ---------------------------------------------------------------------------

export type VoiceRecorderState = "idle" | "recording" | "transcribing";

export interface UseVoiceRecorderReturn {
  state: VoiceRecorderState;
  isRecording: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  mediaStream: MediaStream | null;
}

export interface TranscribeAudioResponse {
  text: string;
}

// ---------------------------------------------------------------------------
// Unified mobile drawer (merges nav + session history for mobile planning)
// ---------------------------------------------------------------------------

export interface UnifiedMobileDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active navigation tab (e.g. "plan", "boards") */
  activeTab: string;
  /** Session sidebar data */
  groups: SessionSidebarProps["groups"];
  activeSessionId: string | null;
  onSessionClick: (id: string) => void;
  onSessionDelete: (id: string) => void;
  onSessionResume: (id: string) => void;
  onNewSession: () => void;
  onSearchOpen: () => void;
  /** Model label shown at bottom of drawer */
  modelLabel?: string;
}

// ---------------------------------------------------------------------------
// Seed Enrichment (pre-send phase)
// ---------------------------------------------------------------------------

export interface SeedEnrichmentCardProps {
  seed: SeedWithRelations;
  annotation: string;
  onAnnotationChange: (seedId: string, annotation: string) => void;
  onSeedClick: (seed: SeedWithRelations) => void;
  onRemove: (seedId: string) => void;
  defaultExpanded?: boolean;
}

export interface SeedEnrichmentListProps {
  seeds: SeedWithRelations[];
  annotations: Record<string, string>;
  onAnnotationChange: (seedId: string, annotation: string) => void;
  onSeedClick: (seed: SeedWithRelations) => void;
  onRemoveSeed: (seedId: string) => void;
  onAddMore: () => void;
  onStart: () => void;
  isStarting: boolean;
}

// ---------------------------------------------------------------------------
// Seed Detail (shared between pre-send and post-send)
// ---------------------------------------------------------------------------

export interface SeedDetailViewProps {
  seed: SeedWithRelations | null;
  annotation?: string;
  onAnnotationChange?: (seedId: string, annotation: string) => void;
  readOnly?: boolean;
  comments: Array<{
    id: string;
    content: string;
    createdAt: string;
    author: { id: string; name: string; image: string | null };
  }>;
  isLoadingComments: boolean;
}

// ---------------------------------------------------------------------------
// Seed Reference Chips (post-send phase)
// ---------------------------------------------------------------------------

export interface SeedReferenceChipsProps {
  seeds: SeedWithRelations[];
  annotations: Record<string, string>;
  onChipClick: (seed: SeedWithRelations) => void;
}
