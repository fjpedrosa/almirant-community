"use client";

import { ParentDetailPanel } from "../components/parent-detail-panel";
import type { WorkItemWithRelations, WorkItemEvent, WorkItemType, Priority, ProvenanceLastOrigin, ProvenanceActiveRun, ProvenanceSessionSummary } from "../../domain/types";
import type { AgentProvider, RepoOption } from "@/domains/agents/domain/types";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import type { BoardColumn, ColumnRole } from "@/domains/boards/domain/types";
import type { RunnerActionType } from "../../domain/column-actions";

interface ParentDetailPanelContainerProps {
  isOpen: boolean;
  parentItem: WorkItemWithRelations | null;
  isLoadingParent: boolean;
  childItems: WorkItemWithRelations[];
  isLoadingChildren: boolean;
  navigateTo: (id: string) => void;
  goBack: () => void;
  canGoBack: boolean;
  closePanel: () => void;
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
  // Action handlers (optional)
  onImplementWithAi?: (provider: AgentProvider, codingAgent?: CodingAgent, model?: string) => void;
  onRunnerAction?: (provider: AgentProvider, actionType: RunnerActionType, codingAgent?: CodingAgent, model?: string) => void;
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
  // Edit mode (optional)
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
  // Metadata editors (optional)
  onTypeChange?: (type: WorkItemType) => void;
  onPriorityChange?: (priority: Priority) => void;
  boardColumns?: BoardColumn[];
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
  // Execution origin data
  executionOriginData?: {
    lastOrigin: ProvenanceLastOrigin | null;
    activeRun: ProvenanceActiveRun | null;
    sessionSummary: ProvenanceSessionSummary | null;
    isLoading: boolean;
  };
  // Advanced sections slot
  advancedSections?: React.ReactNode;
  // Sessions tab content slot
  sessionsContent?: React.ReactNode;
  // AI processing state
  isAiProcessing?: boolean;
  onStopAi?: () => void;
}

export const ParentDetailPanelContainer: React.FC<ParentDetailPanelContainerProps> = ({
  isOpen,
  parentItem,
  isLoadingParent,
  childItems,
  isLoadingChildren,
  navigateTo,
  goBack,
  canGoBack,
  closePanel,
  activeTab,
  onTabChange,
  childrenEvents,
  isLoadingChildrenEvents,
  ownEvents,
  isLoadingOwnEvents,
  showAll,
  onToggleShowAll,
  columnNameById,
  projectNameById,
  onImplementWithAi,
  onRunnerAction,
  columnRole,
  onCopyPrompt,
  onCopySavedPrompt,
  onCopyCliCommand,
  onCopyReviewCommand,
  isCopyingPrompt,
  showCopySuccess,
  projectRepos,
  selectedRepoId,
  onRepoSelect,
  defaultProvider,
  isEditing,
  onToggleEdit,
  editTitle,
  onEditTitleChange,
  editDescription,
  onEditDescriptionChange,
  editDefinitionOfDone,
  onEditDefinitionOfDoneChange,
  onSave,
  isSaving,
  onAiFormatDescription,
  isAiFormattingDescription,
  onAiFormatDefinitionOfDone,
  isAiFormattingDefinitionOfDone,
  defaultEditMode,
  // Metadata editors
  onTypeChange,
  onPriorityChange,
  boardColumns,
  currentColumnId,
  onColumnChange,
  availableAssignees,
  hasActiveTeam,
  selectedAssigneeIds,
  onSelectAssignee,
  onRemoveAssignee,
  dueDate,
  onDueDateChange,
  estimatedHours,
  onEstimatedHoursChange,
  availableParents,
  isLoadingParents,
  onParentChange,
  availableTags,
  isLoadingTags,
  tagIds,
  onTagsChange,
  onCreateTag,
  isBug,
  onBugToggle,
  executionOriginData,
  advancedSections,
  sessionsContent,
  isAiProcessing,
  onStopAi,
}) => {
  // Build ancestors array from the full ancestor chain provided by the backend.
  // ancestors from API is ordered [parent, grandparent, ..., root] — reverse for breadcrumb [root, ..., parent].
  const ancestors = parentItem?.ancestors
    ? [...parentItem.ancestors].reverse()
    : parentItem?.parent
      ? [{ id: parentItem.parent.id, title: parentItem.parent.title, type: parentItem.parent.type, taskId: parentItem.parent.taskId ?? null }]
      : [];

  // `children` here is a data prop (WorkItemWithRelations[]) in ParentDetailPanelProps,
  // not React children -- the lint rule triggers but does not apply.
  const panelProps = {
    open: isOpen,
    onOpenChange: (open: boolean) => {
      if (!open) closePanel();
    },
    item: parentItem,
    isLoading: isLoadingParent,
    ancestors,
    onNavigateToParent: navigateTo,
    children: childItems,
    isLoadingChildren,
    onNavigateToChild: navigateTo,
    canGoBack,
    onGoBack: goBack,
    activeTab,
    onTabChange,
    childrenEvents,
    isLoadingChildrenEvents,
    ownEvents,
    isLoadingOwnEvents,
    showAll,
    onToggleShowAll,
    columnNameById,
    projectNameById,
    onImplementWithAi,
    onRunnerAction,
    columnRole,
    onCopyPrompt,
    onCopySavedPrompt,
    onCopyCliCommand,
    onCopyReviewCommand,
    isCopyingPrompt,
    showCopySuccess,
    projectRepos,
    selectedRepoId,
    onRepoSelect,
    defaultProvider,
    isEditing,
    onToggleEdit,
    editTitle,
    onEditTitleChange,
    editDescription,
    onEditDescriptionChange,
    editDefinitionOfDone,
    onEditDefinitionOfDoneChange,
    onSave,
    isSaving,
    onAiFormatDescription,
    isAiFormattingDescription,
    onAiFormatDefinitionOfDone,
    isAiFormattingDefinitionOfDone,
    defaultEditMode,
    // Metadata editors
    onTypeChange,
    onPriorityChange,
    boardColumns,
    currentColumnId,
    onColumnChange,
    availableAssignees,
    hasActiveTeam,
    selectedAssigneeIds,
    onSelectAssignee,
    onRemoveAssignee,
    dueDate,
    onDueDateChange,
    estimatedHours,
    onEstimatedHoursChange,
    availableParents,
    isLoadingParents,
    onParentChange,
    availableTags,
    isLoadingTags,
    tagIds,
    onTagsChange,
    onCreateTag,
    isBug,
    onBugToggle,
    executionOriginData,
    advancedSections,
    sessionsContent,
    isAiProcessing,
    onStopAi,
  };

  return <ParentDetailPanel {...panelProps} />;
};
