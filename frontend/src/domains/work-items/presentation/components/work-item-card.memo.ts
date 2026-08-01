import { scheduledVisibilityChanged } from "../../domain/utils";
import type { WorkItemMetadata, WorkItemParticipant, WorkItemWithContext } from "../../domain/types";
import type { RunnerActionType } from "../../domain/column-actions";
import type { WorkItemChild } from "./work-item-children-list";
import type { ColumnRole } from "@/domains/boards/domain/types";
import type { AgentJobStatus, AgentProvider, RepoOption } from "@/domains/agents/domain/types";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";

/**
 * `WorkItemCard`'s props and memo comparator, split out from `work-item-card.tsx`
 * on purpose: that file transitively imports heavy providers (auth client,
 * agent job indicators, etc.) that throw at module-load time outside a full
 * app runtime, so it can't be imported in isolation for a unit test. This
 * file only pulls in types (erased at compile time) plus the pure
 * `scheduledVisibilityChanged` helper, so `workItemCardPropsAreEqual` can be
 * tested directly — see `work-item-card.memo.test.ts`.
 */
export interface WorkItemCardProps {
  item: WorkItemWithContext;
  columnName: string;
  /**
   * Reference time for the "Scheduled" badge (backend gate #47), ticked
   * every 60s by `useMinuteNow` at the board container level. Required (not
   * defaulted here) so the memo comparator below can compare `prev.now` vs
   * `next.now`.
   */
  now: Date;
  /** Column role for role-based action resolution */
  columnRole?: ColumnRole;
  compact?: boolean;
  agentJobStatus?: AgentJobStatus;
  agentJobProvider?: AgentProvider;
  onImplementWithAi?: (provider: AgentProvider, codingAgent?: CodingAgent, model?: string) => void;
  isImplementWithAiPending?: boolean;
  /** Generic runner action callback (validate, fix, document) */
  onRunnerAction?: (provider: AgentProvider, actionType: RunnerActionType, codingAgent?: CodingAgent, model?: string) => void;
  isRunnerActionPending?: boolean;
  projectRepos?: RepoOption[];
  selectedRepoId?: string | null;
  onRepoSelect?: (repoId: string | null) => void;
  /** The project's default AI provider for highlighting in the provider selector. */
  defaultProvider?: AgentProvider;
  participants?: WorkItemParticipant[];
  onClick?: () => void;
  onCopyPrompt?: () => void;
  onCopySavedPrompt?: () => void;
  isCopyingPrompt?: boolean;
  showCopySuccess?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onRangeSelect?: () => void;
  isGroupedForDrag?: boolean;
  isJustDropped?: boolean;
  isDragActive?: boolean;
  onCopyTaskCommand?: () => void;
  onCopyReviewCommand?: () => void;
  onCopyCliCommand?: () => void;
  cliCommandCopied?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  childrenItems?: WorkItemChild[];
  isLoadingChildren?: boolean;
  onParentClick?: (parentId: string) => void;
  /** Column name-by-id map for grouped card progress badges */
  columnNamesById?: Record<string, string>;
  /** Column color-by-id map for grouped card progress badges */
  columnColorsById?: Record<string, string>;
}

/**
 * Custom equality for `WorkItemCard`'s `memo`.
 */
export const workItemCardPropsAreEqual = (
  prev: Readonly<WorkItemCardProps>,
  next: Readonly<WorkItemCardProps>
): boolean => {
  return (
    prev.compact === next.compact &&
    prev.item.id === next.item.id &&
    prev.item.title === next.item.title &&
    prev.item.description === next.item.description &&
    prev.item.descriptionPreview === next.item.descriptionPreview &&
    prev.item.hasGeneratedPrompt === next.item.hasGeneratedPrompt &&
    prev.item.hasDefinitionOfDone === next.item.hasDefinitionOfDone &&
    prev.item.type === next.item.type &&
    prev.item.priority === next.item.priority &&
    prev.item.assignee === next.item.assignee &&
    prev.item.assignees === next.item.assignees &&
    prev.item.childrenCount === next.item.childrenCount &&
    prev.item.isVirtualColumn === next.item.isVirtualColumn &&
    prev.item.taskId === next.item.taskId &&
    prev.item.startDate === next.item.startDate &&
    // "Scheduled" badge staleness fix: `now` ticks every 60s (useMinuteNow)
    // independently of any other prop on this card. Only bail out of
    // memoization (force a re-render) when the tick could actually flip
    // THIS card's badge visibility — i.e. `startDate` just crossed `now`.
    // Cards without a startDate, or whose startDate isn't near the
    // boundary, must NOT re-render on every tick.
    !scheduledVisibilityChanged(next.item.startDate, prev.now, next.now) &&
    prev.item.tags === next.item.tags &&
    prev.item.isAiProcessing === next.item.isAiProcessing &&
    prev.item.createdBy === next.item.createdBy &&
    prev.columnName === next.columnName &&
    prev.columnRole === next.columnRole &&
    prev.isSelected === next.isSelected &&
    prev.isGroupedForDrag === next.isGroupedForDrag &&
    prev.isJustDropped === next.isJustDropped &&
    prev.isDragActive === next.isDragActive &&
    prev.isCopyingPrompt === next.isCopyingPrompt &&
    prev.showCopySuccess === next.showCopySuccess &&
    prev.onClick === next.onClick &&
    prev.onCopyPrompt === next.onCopyPrompt &&
    prev.onCopySavedPrompt === next.onCopySavedPrompt &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.onRangeSelect === next.onRangeSelect &&
    prev.item.metadata === next.item.metadata &&
    (prev.item.metadata as WorkItemMetadata)?.isBug === (next.item.metadata as WorkItemMetadata)?.isBug &&
    (prev.item.metadata as WorkItemMetadata)?.tested === (next.item.metadata as WorkItemMetadata)?.tested &&
    (prev.item.metadata as WorkItemMetadata)?.dod_approved === (next.item.metadata as WorkItemMetadata)?.dod_approved &&
    (prev.item.metadata as WorkItemMetadata)?.dod_human_action_required === (next.item.metadata as WorkItemMetadata)?.dod_human_action_required &&
    (prev.item.metadata as WorkItemMetadata)?.dod_human_action === (next.item.metadata as WorkItemMetadata)?.dod_human_action &&
    (prev.item.metadata as WorkItemMetadata)?.dod_human_action_reason === (next.item.metadata as WorkItemMetadata)?.dod_human_action_reason &&
    (prev.item.metadata as WorkItemMetadata)?.dod_human_review_required === (next.item.metadata as WorkItemMetadata)?.dod_human_review_required &&
    (prev.item.metadata as WorkItemMetadata)?.dod_human_review_reason === (next.item.metadata as WorkItemMetadata)?.dod_human_review_reason &&
    (prev.item.metadata as WorkItemMetadata)?.dod_auto_remediation_blocked === (next.item.metadata as WorkItemMetadata)?.dod_auto_remediation_blocked &&
    (prev.item.metadata as WorkItemMetadata)?.dod_external_validation_required === (next.item.metadata as WorkItemMetadata)?.dod_external_validation_required &&
    (prev.item.metadata as WorkItemMetadata)?.dod_external_validation_reason === (next.item.metadata as WorkItemMetadata)?.dod_external_validation_reason &&
    (prev.item.metadata as WorkItemMetadata)?.dod_external_validation_tools === (next.item.metadata as WorkItemMetadata)?.dod_external_validation_tools &&
    (prev.item.metadata as WorkItemMetadata)?.previewUrl === (next.item.metadata as WorkItemMetadata)?.previewUrl &&
    (prev.item.metadata as WorkItemMetadata)?.pullRequest?.state === (next.item.metadata as WorkItemMetadata)?.pullRequest?.state &&
    (prev.item.metadata as WorkItemMetadata)?.pullRequest?.number === (next.item.metadata as WorkItemMetadata)?.pullRequest?.number &&
    (prev.item.metadata as WorkItemMetadata)?.releasePullRequest?.state === (next.item.metadata as WorkItemMetadata)?.releasePullRequest?.state &&
    (prev.item.metadata as WorkItemMetadata)?.releasePullRequest?.number === (next.item.metadata as WorkItemMetadata)?.releasePullRequest?.number &&
    (prev.item.metadata as WorkItemMetadata)?.releasePullRequest?.releaseNumber === (next.item.metadata as WorkItemMetadata)?.releasePullRequest?.releaseNumber &&
    (prev.item.metadata as WorkItemMetadata)?.ciStatus?.status === (next.item.metadata as WorkItemMetadata)?.ciStatus?.status &&
    (prev.item.metadata as WorkItemMetadata)?.ciStatus?.conclusion === (next.item.metadata as WorkItemMetadata)?.ciStatus?.conclusion &&
    (prev.item.metadata as Record<string, unknown> | undefined)?.lastAiError === (next.item.metadata as Record<string, unknown> | undefined)?.lastAiError &&
    (prev.item.metadata as Record<string, unknown> | undefined)?.estimatedPoints === (next.item.metadata as Record<string, unknown> | undefined)?.estimatedPoints &&
    prev.onCopyTaskCommand === next.onCopyTaskCommand &&
    prev.onCopyReviewCommand === next.onCopyReviewCommand &&
    prev.onCopyCliCommand === next.onCopyCliCommand &&
    prev.cliCommandCopied === next.cliCommandCopied &&
    prev.isExpanded === next.isExpanded &&
    prev.childrenItems === next.childrenItems &&
    prev.isLoadingChildren === next.isLoadingChildren &&
    prev.agentJobStatus === next.agentJobStatus &&
    prev.agentJobProvider === next.agentJobProvider &&
    prev.onImplementWithAi === next.onImplementWithAi &&
    prev.isImplementWithAiPending === next.isImplementWithAiPending &&
    prev.onRunnerAction === next.onRunnerAction &&
    prev.isRunnerActionPending === next.isRunnerActionPending &&
    prev.projectRepos === next.projectRepos &&
    prev.selectedRepoId === next.selectedRepoId &&
    prev.onRepoSelect === next.onRepoSelect &&
    prev.participants === next.participants &&
    prev.onParentClick === next.onParentClick &&
    prev.columnNamesById === next.columnNamesById &&
    prev.columnColorsById === next.columnColorsById &&
    prev.item.childrenSummary === next.item.childrenSummary
  );
};
