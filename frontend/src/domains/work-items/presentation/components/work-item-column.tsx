"use client";

import { memo, useCallback, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkItemCard } from "./work-item-card";
import { hasSavedPrompt } from "../../domain/card-fields";
import { GroupHeader } from "./group-header";
import {
  TriggerBatchButtonContainer,
  ReleaseApprovalContainer,
} from "@/domains/integration-batches";
import type { WorkItemChild } from "./work-item-children-list";
import type { AgentJob, AgentProvider, RepoOption } from "@/domains/agents/domain/types";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import type { RunnerActionType } from "../../domain/column-actions";
import type { GroupByMode, WorkItemColumnProps, WorkItemParticipant, WorkItemWithContext } from "../../domain/types";
import {
  buildGroupsBy,
  buildHierarchyGroups,
  buildTopmostNodeProjection,
  topmostProjectionToGroups,
  flattenSingleChildChains,
  flattenTreeToRenderList,
  type HierarchyRenderItem,
} from "../../domain/hierarchy-utils";

const ESTIMATED_CARD_HEIGHT = 128;
const ESTIMATED_COMPACT_CARD_HEIGHT = 48;
const ESTIMATED_GROUP_HEADER_HEIGHT = 40;
const ITEM_GAP = 8;

/**
 * Merges existing participants with aggregated assignees from child work items.
 * Used for virtual column items (epics/features) to show all assignees from descendant tasks.
 * Deduplicates by userId so each person appears only once.
 */
function mergeParticipantsWithAggregatedAssignees(
  existing: WorkItemParticipant[],
  aggregatedAssignees?: { id: string; name: string; email: string; image: string | null }[]
): WorkItemParticipant[] {
  if (!aggregatedAssignees || aggregatedAssignees.length === 0) return existing;

  const seenUserIds = new Set(existing.map((p) => p.userId));
  const merged = [...existing];

  for (const assignee of aggregatedAssignees) {
    if (!seenUserIds.has(assignee.id)) {
      seenUserIds.add(assignee.id);
      merged.push({
        userId: assignee.id,
        userName: assignee.name,
        userImage: assignee.image,
        lastAction: "updated",
        lastActionDate: new Date().toISOString(),
        actions: [],
      });
    }
  }

  return merged;
}

type VirtualEntry =
  | { kind: "group-header"; entry: Extract<HierarchyRenderItem, { kind: "group-header" }> }
  | { kind: "work-item"; item: WorkItemWithContext };

const WorkItemColumnInner: React.FC<WorkItemColumnProps & {
  compact?: boolean;
  onCopyPrompt?: (item: WorkItemWithContext) => void;
  onCopySavedPrompt?: (itemId: string) => void;
  copyingPromptId?: string | null;
  copySuccessId?: string | null;
  selectedIds?: Set<string>;
  onToggleSelect?: (itemId: string) => void;
  onRangeSelect?: (itemId: string, columnItemIds: string[]) => void;
  activeItemId?: string | null;
  justDroppedIds?: Set<string>;
  isDragActive?: boolean;
  onCopyTaskCommand?: (taskId: string) => void;
  onCopyReviewCommand?: (taskId: string) => void;
  onCopyCliCommand?: (item: WorkItemWithContext) => void;
  cliCommandCopiedId?: string | null;
  agentJobMap?: Map<string, AgentJob>;
  onImplementWithAi?: (workItemId: string, provider: AgentProvider, codingAgent?: CodingAgent, model?: string) => void;
  isImplementWithAiPending?: boolean;
  implementingWorkItemId?: string | null;
  onRunnerAction?: (workItemId: string, provider: AgentProvider, actionType: RunnerActionType, codingAgent?: CodingAgent, model?: string) => void;
  runnerActionPendingId?: string | null;
  projectRepos?: RepoOption[];
  selectedRepoId?: string | null;
  onRepoSelect?: (repoId: string | null) => void;
  /** Map of project ID to default AI provider for highlighting in the provider selector. */
  defaultProviderByProjectId?: Record<string, AgentProvider>;
  participantsByItemId?: Record<string, WorkItemParticipant[]>;
  expandedItemId?: string | null;
  onToggleExpand?: (itemId: string) => void;
  expandedChildren?: WorkItemChild[];
  isLoadingChildren?: boolean;
  groupBy?: GroupByMode;
  ungroupedLabel?: string;
  collapsedGroups?: Set<string>;
  onToggleGroupCollapse?: (groupKey: string) => void;
  onParentClick?: (parentId: string) => void;
}> = ({
  compact,
  column,
  items,
  onAddItem,
  onItemClick,
  onCopyPrompt,
  onCopySavedPrompt,
  copyingPromptId,
  copySuccessId,
  selectedIds,
  onToggleSelect,
  onRangeSelect,
  activeItemId,
  justDroppedIds,
  isDragActive,
  onCopyTaskCommand,
  onCopyReviewCommand,
  onCopyCliCommand,
  cliCommandCopiedId,
  agentJobMap,
  onImplementWithAi,
  isImplementWithAiPending,
  implementingWorkItemId,
  onRunnerAction,
  runnerActionPendingId,
  projectRepos,
  selectedRepoId,
  onRepoSelect,
  defaultProviderByProjectId,
  participantsByItemId,
  expandedItemId,
  onToggleExpand,
  expandedChildren,
  isLoadingChildren,
  groupBy,
  ungroupedLabel,
  collapsedGroups,
  onToggleGroupCollapse,
  onParentClick,
  integrationContext,
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const isActiveInColumn = activeItemId != null && items.some((i) => i.id === activeItemId);
  const parentRef = useRef<HTMLDivElement | null>(null);

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);

  const collapsedGroupsSet = useMemo(
    () => collapsedGroups ?? new Set<string>(),
    [collapsedGroups]
  );

  const renderList = useMemo((): HierarchyRenderItem[] | null => {
    if (!groupBy || groupBy === "none") return null;
    let tree;
    if (groupBy === "hierarchy") {
      tree = buildHierarchyGroups(items);
    } else if (groupBy === "topmost") {
      const projections = buildTopmostNodeProjection(items);
      tree = topmostProjectionToGroups(projections);
    } else {
      tree = buildGroupsBy(items, groupBy);
    }
    const flattened = flattenSingleChildChains(tree);
    return flattenTreeToRenderList(flattened, collapsedGroupsSet);
  }, [groupBy, items, collapsedGroupsSet]);

  // Build a flat list of entries for the virtualizer
  const virtualEntries = useMemo((): VirtualEntry[] => {
    if (renderList) {
      return renderList.map((entry) =>
        entry.kind === "group-header"
          ? { kind: "group-header" as const, entry }
          : { kind: "work-item" as const, item: entry.item }
      );
    }
    return items.map((item) => ({ kind: "work-item" as const, item }));
  }, [renderList, items]);

  const getScrollElement = useCallback(() => parentRef.current, []);

  const cardHeight = compact ? ESTIMATED_COMPACT_CARD_HEIGHT : ESTIMATED_CARD_HEIGHT;

  const estimateSize = useCallback(
    (index: number) => {
      const entry = virtualEntries[index];
      return (
        (entry.kind === "group-header"
          ? ESTIMATED_GROUP_HEADER_HEIGHT
          : cardHeight) + ITEM_GAP
      );
    },
    [virtualEntries, cardHeight],
  );

  // TanStack Virtual is not React Compiler memo-safe and triggers this lint rule by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: virtualEntries.length,
    getScrollElement,
    estimateSize,
    overscan: 10,
  });

  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      parentRef.current = node;
    },
    [setNodeRef]
  );

  const handleItemClick = useCallback(
    (itemId: string) => onItemClick?.(itemId),
    [onItemClick]
  );

  const handleCopyPrompt = useCallback(
    (item: WorkItemWithContext) => onCopyPrompt?.(item),
    [onCopyPrompt]
  );

  const handleToggleSelect = useCallback(
    (itemId: string) => onToggleSelect?.(itemId),
    [onToggleSelect]
  );

  const handleRangeSelect = useCallback(
    (itemId: string) => onRangeSelect?.(itemId, itemIds),
    [onRangeSelect, itemIds]
  );

  const renderCard = (item: WorkItemWithContext) => {
    const job = agentJobMap?.get(item.id);
    const agentJobStatus = job?.status;
    const agentJobProvider = job?.provider;
    const isGroupedForDrag =
      activeItemId != null &&
      selectedIds != null &&
      selectedIds.size > 1 &&
      selectedIds.has(item.id) &&
      item.id !== activeItemId;
    return (
      <WorkItemCard
        item={item}
        columnName={column.name}
        columnRole={column.role}
        compact={compact}
        agentJobStatus={agentJobStatus}
        agentJobProvider={agentJobProvider}
        onImplementWithAi={
          onImplementWithAi
            ? (provider, codingAgent, model) => onImplementWithAi(item.id, provider, codingAgent, model)
            : undefined
        }
        isImplementWithAiPending={
          !!isImplementWithAiPending && implementingWorkItemId === item.id
        }
        onRunnerAction={
          onRunnerAction
            ? (provider, actionType, codingAgent, model) => onRunnerAction(item.id, provider, actionType, codingAgent, model)
            : undefined
        }
        isRunnerActionPending={runnerActionPendingId === item.id}
        projectRepos={projectRepos}
        selectedRepoId={selectedRepoId}
        onRepoSelect={onRepoSelect}
        defaultProvider={item.projectId && defaultProviderByProjectId ? defaultProviderByProjectId[item.projectId] : undefined}
        participants={mergeParticipantsWithAggregatedAssignees(
          participantsByItemId?.[item.id] ?? [],
          item.isVirtualColumn ? item.childrenSummary?.aggregatedAssignees : undefined
        )}
        onClick={() => handleItemClick(item.id)}
        onCopyPrompt={onCopyPrompt ? () => handleCopyPrompt(item) : undefined}
        onCopySavedPrompt={
          onCopySavedPrompt && hasSavedPrompt(item)
            ? () => onCopySavedPrompt(item.id)
            : undefined
        }
        isCopyingPrompt={copyingPromptId === item.id}
        showCopySuccess={copySuccessId === item.id}
        isSelected={selectedIds?.has(item.id)}
        onToggleSelect={onToggleSelect ? () => handleToggleSelect(item.id) : undefined}
        onRangeSelect={onRangeSelect ? () => handleRangeSelect(item.id) : undefined}
        isGroupedForDrag={isGroupedForDrag}
        isJustDropped={justDroppedIds?.has(item.id)}
        isDragActive={isDragActive}
        onCopyTaskCommand={item.taskId && onCopyTaskCommand ? () => onCopyTaskCommand(item.taskId!) : undefined}
        onCopyReviewCommand={item.taskId && onCopyReviewCommand ? () => onCopyReviewCommand(item.taskId!) : undefined}
        onCopyCliCommand={item.taskId && onCopyCliCommand ? () => onCopyCliCommand(item) : undefined}
        cliCommandCopied={cliCommandCopiedId === item.id}
        isExpanded={expandedItemId === item.id}
        onToggleExpand={item.childrenCount > 0 && onToggleExpand ? () => onToggleExpand(item.id) : undefined}
        childrenItems={expandedItemId === item.id ? expandedChildren : undefined}
        isLoadingChildren={expandedItemId === item.id ? isLoadingChildren : undefined}
        onParentClick={onParentClick}
      />
    );
  };

  const renderGroupHeader = (entry: Extract<HierarchyRenderItem, { kind: "group-header" }>) => {
    const { node, groupKey, depth } = entry;
    const isCollapsed = collapsedGroupsSet.has(groupKey);
    return (
      <GroupHeader
        parentId={node.ancestor?.id ?? null}
        parentTitle={node.ancestor?.title ?? null}
        parentType={node.ancestor?.type ?? null}
        parentTaskId={node.ancestor?.taskId ?? null}
        ungroupedLabel={node.ancestor ? undefined : ungroupedLabel}
        itemCount={node.totalItemCount}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => onToggleGroupCollapse?.(groupKey)}
        depth={depth}
        onParentClick={onParentClick}
      />
    );
  };

  return (
    <div className={cn("shrink-0 flex flex-col h-full", compact ? "w-[260px]" : "w-[280px] sm:w-[300px]")}>
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: column.color }}
          />
          <h3 className="font-medium text-sm">{column.name}</h3>
          <Badge variant="secondary" className="text-xs">
            {items.length}
          </Badge>
          {column.role === "validating" && integrationContext && (
            <TriggerBatchButtonContainer
              projectId={integrationContext.projectId}
              repositoryId={integrationContext.repositoryId}
              boardId={integrationContext.boardId}
              validatingWorkItemIds={items.map((i) => i.id)}
            />
          )}
          {column.role === "release" && integrationContext && (
            <ReleaseApprovalContainer
              projectId={integrationContext.projectId}
              repositoryId={integrationContext.repositoryId}
            />
          )}
        </div>
        {onAddItem && (
          <Button variant="ghost" size="sm" onClick={onAddItem}>
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div
        ref={mergedRef}
        className={cn(
          "flex-1 rounded-lg p-2 pb-4 min-h-[200px] overflow-y-auto overflow-x-hidden transition-colors duration-200",
          isOver || isActiveInColumn
            ? "bg-primary/10 ring-2 ring-primary/40 ring-inset"
            : "bg-muted/30"
        )}
      >
        <SortableContext
          id={column.id}
          items={itemIds}
          strategy={verticalListSortingStrategy}
        >
          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const ve = virtualEntries[virtualRow.index];
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div style={{ paddingBottom: `${ITEM_GAP}px` }}>
                    {ve.kind === "group-header"
                      ? renderGroupHeader(ve.entry)
                      : renderCard(ve.item)}
                  </div>
                </div>
              );
            })}
          </div>
        </SortableContext>
      </div>
    </div>
  );
};

export const WorkItemColumn = memo(WorkItemColumnInner, (prev, next) => {
  if (prev.compact !== next.compact) return false;
  if (prev.column.id !== next.column.id) return false;
  if (prev.column.name !== next.column.name) return false;
  if (prev.column.color !== next.column.color) return false;
  if (prev.items.length !== next.items.length) return false;
  for (let i = 0; i < prev.items.length; i++) {
    if (prev.items[i].id !== next.items[i].id) return false;
    if (prev.items[i].metadata !== next.items[i].metadata) return false;
    if (prev.items[i].childrenSummary !== next.items[i].childrenSummary) return false;
  }
  if (prev.copyingPromptId !== next.copyingPromptId) return false;
  if (prev.copySuccessId !== next.copySuccessId) return false;
  if (prev.selectedIds !== next.selectedIds) return false;
  if (prev.activeItemId !== next.activeItemId) return false;
  if (prev.justDroppedIds !== next.justDroppedIds) return false;
  if (prev.isDragActive !== next.isDragActive) return false;
  if (prev.onAddItem !== next.onAddItem) return false;
  if (prev.onItemClick !== next.onItemClick) return false;
  if (prev.onCopyPrompt !== next.onCopyPrompt) return false;
  if (prev.onCopySavedPrompt !== next.onCopySavedPrompt) return false;
  if (prev.onToggleSelect !== next.onToggleSelect) return false;
  if (prev.onRangeSelect !== next.onRangeSelect) return false;
  if (prev.onCopyTaskCommand !== next.onCopyTaskCommand) return false;
  if (prev.onCopyReviewCommand !== next.onCopyReviewCommand) return false;
  if (prev.onCopyCliCommand !== next.onCopyCliCommand) return false;
  if (prev.cliCommandCopiedId !== next.cliCommandCopiedId) return false;
  if (prev.agentJobMap !== next.agentJobMap) return false;
  if (prev.onImplementWithAi !== next.onImplementWithAi) return false;
  if (prev.isImplementWithAiPending !== next.isImplementWithAiPending) return false;
  if (prev.implementingWorkItemId !== next.implementingWorkItemId) return false;
  if (prev.onRunnerAction !== next.onRunnerAction) return false;
  if (prev.runnerActionPendingId !== next.runnerActionPendingId) return false;
  if (prev.projectRepos !== next.projectRepos) return false;
  if (prev.selectedRepoId !== next.selectedRepoId) return false;
  if (prev.onRepoSelect !== next.onRepoSelect) return false;
  if (prev.participantsByItemId !== next.participantsByItemId) return false;
  if (prev.expandedItemId !== next.expandedItemId) return false;
  if (prev.expandedChildren !== next.expandedChildren) return false;
  if (prev.isLoadingChildren !== next.isLoadingChildren) return false;
  if (prev.groupBy !== next.groupBy) return false;
  if (prev.ungroupedLabel !== next.ungroupedLabel) return false;
  if (prev.collapsedGroups !== next.collapsedGroups) return false;
  if (prev.onToggleGroupCollapse !== next.onToggleGroupCollapse) return false;
  if (prev.onParentClick !== next.onParentClick) return false;
  return true;
});

WorkItemColumn.displayName = "WorkItemColumn";
