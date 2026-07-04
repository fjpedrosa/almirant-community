"use client";

import { useMemo, useCallback, useEffect, useState, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from "@dnd-kit/core";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Search, RotateCcw, CalendarDays, SlidersHorizontal, Columns3, Rows3, X } from "lucide-react";
import { SortDropdown, type SortOption } from "@/domains/shared/presentation/components/sort-dropdown";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useTranslations } from "next-intl";
import { useWorkItemsByBoard, useWorkItemsByArea } from "../../application/hooks/use-work-item-board";
import { useSprintFilter } from "../../application/hooks/use-sprint-filter";
import { useWorkItemKanban } from "../../application/hooks/use-work-item-kanban";
import { useCreateWorkItemForm } from "../../application/hooks/use-create-work-item-form";
// useEditWorkItemForm removed - edit flow now uses side panel via useWorkItemDetailPanel
import { useCopyAsPrompt } from "../../application/hooks/use-copy-as-prompt";
import { useBoardSelection } from "../../application/hooks/use-board-selection";
import { useBulkMove } from "../../application/hooks/use-work-item-bulk";
import { useCopyCliCommand } from "../../application/hooks/use-copy-cli-command";
import { useBoardFilters } from "../../application/hooks/use-board-filters";
import { useWorkItemTypeFilter } from "../../application/hooks/use-work-item-type-filter";
import { useAllBoards } from "@/domains/boards/application/hooks/use-boards";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useProjectAiConfig } from "@/domains/projects/application/hooks/use-project-ai-config";
import type { AgentProvider, AgentJobType, RunnerSkillName, TriggerType } from "@/domains/agents/domain/types";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import type { RunnerActionType } from "../../domain/column-actions";
import { useAgentJobMap } from "@/domains/agents/application/hooks/use-agent-job-map";
import { useAgentJobNotifications } from "@/domains/agents/application/hooks/use-agent-job-notifications";
import { useEnqueueAgentJob, useBatchEnqueueAgentJobs, useCancelAgentJob } from "@/domains/agents/application/hooks/use-enqueue-agent-job";
import { useProjectRepos } from "@/domains/agents/application/hooks/use-project-repos";
import { AgentActivityContainer } from "@/domains/agents/presentation/containers/agent-activity-container";
import { useWorkItemChildren } from "../../application/hooks/use-work-item-children";
import { useResetAiProcessing } from "../../application/hooks/use-work-items";
import { useWorkItemParticipants } from "../../application/hooks/use-work-item-participants";
import { useWorkItemDetailPanel } from "../../application/hooks/use-work-item-detail-panel";
import { ParentDetailPanelContainer } from "./parent-detail-panel-container";
import { PanelAdvancedSections } from "./panel-advanced-sections";
import { SessionsTabContainer } from "./sessions-tab-container";
import { WorkItemColumn } from "../components/work-item-column";
import { useCreateParentDialog } from "../../application/hooks/use-create-parent-dialog";
import { useGenerateDocs } from "../../application/hooks/use-generate-docs";
import { WorkItemFormDialog } from "../components/work-item-form-dialog";
import { GenerateDocsDialog } from "../components/generate-docs-dialog";
import { PendingFilesSection } from "../components/pending-files-section";
import { SelectionActionBar } from "../components/selection-action-bar";
import { SavedViewsContainer } from "./saved-views-container";
import { DynamicFilters } from "@/domains/shared/presentation/components/filters/dynamic-filters";
import { ShareProgressBanner } from "@/domains/shared/presentation/components/share-progress-banner";
import { ShareToXDialog } from "@/domains/sprints/presentation/components/share-to-x-dialog";
import { useLast7dShareSource } from "@/domains/sprints/application/hooks/use-last-7d-share-source";
import { useSprintShare } from "@/domains/sprints/application/hooks/use-sprint-share";
import { typeBadgeColors } from "../components/work-item-style";
import { KanbanBoardSkeleton } from "@/components/skeletons";
import { uploadsApi } from "@/lib/api/client";
import type { WorkItemBoardContainerProps, WorkItemMetadata, WorkItemParticipant, WorkItemsByColumn, WorkItemWithContext, WorkItemFormData, WorkItemType, Priority, SavedViewConfig, BoardSortBy } from "../../domain/types";
import { filterToTopmostItems } from "../../domain/hierarchy-utils";
import { buildBoardAssigneeOptions } from "../../domain/board-assignee-options";
import {
  resolveManualImplementRunnerJob,
  shouldBlockManualImplementForDodHumanReview,
} from "../../domain/runner-action-resolution";
import { useHorizontalScrollIndicators } from "@/domains/shared/application/hooks/use-horizontal-scroll-indicators";



const EMPTY_COLUMNS: WorkItemsByColumn[] = [];
const EMPTY_PARTICIPANTS_MAP: Record<string, WorkItemParticipant[]> = {};
const dropAnimationConfig: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0" } },
  }),
};

// Priority ordering for sorting (lower number = higher priority)
const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Sort items within a column based on the selected sort option.
 * When sortBy is "manual", items are returned in their original order (position + createdAt).
 * Items with null values for the sort field are placed last.
 */
const sortColumnItems = (
  items: WorkItemWithContext[],
  sortBy: BoardSortBy,
  sortDirection: "asc" | "desc"
): WorkItemWithContext[] => {
  if (sortBy === "manual") {
    // Manual = preserve original order (already sorted by position + createdAt from backend)
    return items;
  }

  const sorted = [...items].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "priority": {
        // Items without priority go last
        const aVal = a.priority ? PRIORITY_ORDER[a.priority] : 99;
        const bVal = b.priority ? PRIORITY_ORDER[b.priority] : 99;
        comparison = aVal - bVal;
        break;
      }
      case "createdAt": {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        comparison = aTime - bTime;
        break;
      }
      case "updatedAt": {
        const aTime = new Date(a.updatedAt).getTime();
        const bTime = new Date(b.updatedAt).getTime();
        comparison = aTime - bTime;
        break;
      }
      case "dueDate": {
        // Items without dueDate go last (use Infinity for null dates)
        const aDate = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDate = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        // If both are Infinity (no date), they are equal
        if (aDate === Infinity && bDate === Infinity) {
          comparison = 0;
        } else {
          comparison = aDate - bDate;
        }
        break;
      }
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });

  return sorted;
};

const OPEN_WORK_ITEM_EVENT = "mc:open-work-item";
const SHARE_CTA_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const getShareCtaStorageKey = (boardId: string) =>
  `share-cta:last7d:${boardId}:dismissed-at`;

type PromptCopyItem = Pick<WorkItemWithContext, "id" | "title" | "description" | "metadata">;
type CliCommandCopyItem = Pick<WorkItemWithContext, "id" | "taskId" | "parentId" | "parentTaskId" | "type">;

const shouldShowShareCta = (boardId: string) => {
  if (typeof window === "undefined") return false;
  const value = localStorage.getItem(getShareCtaStorageKey(boardId));
  if (!value) return true;

  const lastDismissedAt = Number(value);
  if (!Number.isFinite(lastDismissedAt)) return true;

  return Date.now() - lastDismissedAt >= SHARE_CTA_COOLDOWN_MS;
};

export const WorkItemBoardContainer: React.FC<WorkItemBoardContainerProps> = ({
  activeBoardId,
  activeBoard,
  area,
}) => {
  const t = useTranslations("workItems");
  const router = useRouter();
  const pathname = usePathname();
  // Derive unique assignee options from board items for the filter dropdown.
  // Uses a ref to avoid circular dependency: useBoardFilters needs assignees,
  // but assignees come from column data which needs filterParams from useBoardFilters.
  const [assigneeOptions, setAssigneeOptions] = useState<
    { value: string; label: string }[]
  >([]);

  const {
    search,
    setSearch,
    config: baseFiltersConfig,
    dynamicFilters,
    filterParams,
    groupBy,
    setGroupBy,
    sortBy,
    sortDirection,
    setSort,
    isPrefsLoaded,
  } = useBoardFilters(assigneeOptions, { boardId: activeBoardId, area });

  // Sprint filter (only for single-board view, not area view)
  const {
    sprintOptions,
    selectedSprintId,
    setSelectedSprintId,
    isSprintResolved,
  } = useSprintFilter(activeBoardId);

  // Merge sprint filter into filterParams
  const mergedFilterParams = useMemo(() => {
    if (!selectedSprintId && !filterParams) return undefined;
    const params: Record<string, string> = { ...(filterParams ?? {}) };
    if (selectedSprintId) {
      params.sprintId = selectedSprintId;
    }
    return Object.keys(params).length > 0 ? params : undefined;
  }, [filterParams, selectedSprintId]);

  // Collapsed groups state (shared across all columns)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Compact / normal view mode toggle
  const [viewMode, setViewMode] = useState<"normal" | "compact">("normal");

  const handleToggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === "normal" ? "compact" : "normal";
      if (next === "compact") {
        setCollapsedGroups(new Set());
      }
      return next;
    });
  }, []);

  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  // Single-board: hold the fetch until the sprint auto-selection resolves so it
  // fires ONCE with the correct sprint filter (no empty-filter fetch + refetch).
  const boardQuery = useWorkItemsByBoard(
    area ? "" : activeBoardId,
    area ? undefined : mergedFilterParams,
    area ? true : isSprintResolved,
  );
  const areaQuery = useWorkItemsByArea(area ?? "", area ? filterParams : undefined);
  const { data: columnData, isLoading } = area ? areaQuery : boardQuery;
  const columns = useMemo(
    () => (columnData as WorkItemsByColumn[]) ?? EMPTY_COLUMNS,
    [columnData]
  );

  // Update assignee options when column data changes
  useEffect(() => {
    const options = buildBoardAssigneeOptions(
      (columnData as WorkItemsByColumn[]) ?? []
    );
    const frame = requestAnimationFrame(() => {
      setAssigneeOptions((prev) => {
        if (prev.length === options.length && prev.every((p, i) => p.value === options[i].value)) {
          return prev;
        }
        return options;
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [columnData]);

  // Map of work item id -> title for agent activity panel
  const workItemTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of columns) {
      for (const item of col.items) {
        map.set(item.id, item.title);
      }
    }
    return map;
  }, [columns]);

  // Grouped view: hide child items whose parent is also in the board
  const groupedFilteredColumns = useMemo(
    () => filterToTopmostItems(columns),
    [columns]
  );

  // Bug filter (client-side, from URL ?isBug=true)
  const bugFilteredColumns = useMemo(() => {
    if (filterParams?.isBug !== "true") return groupedFilteredColumns;
    return groupedFilteredColumns.map((col) => {
      const filteredItems = col.items.filter(
        (item) => item.metadata?.isBug === true
      );
      return {
        ...col,
        items: filteredItems,
        count: filteredItems.length,
      };
    });
  }, [groupedFilteredColumns, filterParams?.isBug]);

  // Type filter tabs (client-side, persisted in URL ?type=)
  const { activeType, setActiveType, filterColumnsByType, computeCounts } = useWorkItemTypeFilter();

  // Compute type counts from bug-filtered items (before type filter)
  const typeFilterCounts = useMemo(
    () => computeCounts(bugFilteredColumns.flatMap((col) => col.items)),
    [computeCounts, bugFilteredColumns]
  );

  // Apply type filter after bug filter
  const typeFilteredColumns = useMemo(
    () => filterColumnsByType(bugFilteredColumns),
    [filterColumnsByType, bugFilteredColumns]
  );

  // Apply client-side sorting within each column
  const sortedColumns = useMemo(
    () =>
      typeFilteredColumns.map((col) => ({
        ...col,
        items: sortColumnItems(col.items, sortBy, sortDirection),
      })),
    [typeFilteredColumns, sortBy, sortDirection]
  );

  const manualImplementContextById = useMemo(() => {
    const map = new Map<string, {
      item: WorkItemWithContext;
      columnName: string | null;
      columnRole: WorkItemsByColumn["column"]["role"] | null;
    }>();
    for (const col of sortedColumns) {
      for (const item of col.items) {
        map.set(item.id, {
          item,
          columnName: col.column.name,
          columnRole: col.column.role,
        });
      }
    }
    return map;
  }, [sortedColumns]);

  // Boards list for garbage collection of stale localStorage entries
  const { data: allBoardsData } = useAllBoards();
  const validBoardIds = useMemo(
    () => (allBoardsData ?? []).map((b) => b.id),
    [allBoardsData]
  );

  // Name lookup maps for EventTimeline in parent detail panel
  const { data: projectsList = [] } = useProjects();
  const columnNameById = useMemo(
    () => (allBoardsData ?? []).reduce<Record<string, string>>((acc, board) => {
      for (const column of board.columns) {
        acc[column.id] = column.name;
      }
      return acc;
    }, {}),
    [allBoardsData]
  );
  const projectNameById = useMemo(
    () => projectsList.reduce<Record<string, string>>((acc, project) => {
      acc[project.id] = project.name;
      return acc;
    }, {}),
    [projectsList]
  );

  const clearActiveSavedViewRef = useRef<(() => void) | null>(null);
  const handleRegisterClearActiveView = useCallback((clearFn: () => void) => {
    clearActiveSavedViewRef.current = clearFn;
  }, []);

  // Saved views: capture current config and provide apply handler
  const currentViewConfig = useMemo((): SavedViewConfig => {
    const config: SavedViewConfig = {};
    const filters = dynamicFilters.getFilterParams();
    if (Object.keys(filters).length > 0) config.filters = filters;
    if (search) config.search = search;
    if (groupBy && groupBy !== "none") config.groupBy = groupBy;
    if (activeType !== "all") config.typeFilter = activeType;
    return config;
  }, [dynamicFilters, search, groupBy, activeType]);

  const handleApplyView = useCallback((config: SavedViewConfig) => {
    // Build new URL params from the saved view config
    const params = new URLSearchParams();

    // Restore filters
    if (config.filters) {
      for (const [key, value] of Object.entries(config.filters)) {
        params.set(key, value);
      }
    }

    // Restore search
    if (config.search) {
      params.set("search", config.search);
    }

    // Restore groupBy
    if (config.groupBy) {
      params.set("groupBy", config.groupBy);
    }

    // Restore type filter
    if (config.typeFilter && config.typeFilter !== "all") {
      params.set("type", config.typeFilter as string);
    }

    // Push the URL update (this will update dynamic filters, search, groupBy, and type)
    const paramString = params.toString();
    const url = paramString ? `${pathname}?${paramString}` : pathname;
    router.push(url, { scroll: false });

    showToast.success(t("savedViews.viewApplied"));
  }, [pathname, router, t]);

  // Sort options for the SortDropdown
  const sortOptions: SortOption<BoardSortBy>[] = useMemo(
    () => [
      { value: "manual", label: t("kanban.sort.manual") },
      { value: "priority", label: t("kanban.sort.priority") },
      { value: "createdAt", label: t("kanban.sort.created") },
      { value: "updatedAt", label: t("kanban.sort.updated") },
      { value: "dueDate", label: t("kanban.sort.dueDate") },
    ],
    [t]
  );

  const formDefaults = useMemo((): Partial<WorkItemFormData> => {
    const defaults: Partial<WorkItemFormData> = {};
    if (filterParams?.type) defaults.type = filterParams.type as WorkItemType;
    else if (activeType !== "all") defaults.type = activeType;
    if (filterParams?.priority) defaults.priority = filterParams.priority as Priority;
    if (filterParams?.projectId) defaults.projectId = filterParams.projectId;
    if (filterParams?.assignee) defaults.assignee = filterParams.assignee;
    if (filterParams?.tagIds) defaults.tagIds = filterParams.tagIds.split(",");
    return defaults;
  }, [filterParams, activeType]);

  const { selectedIds, toggleSelect, rangeSelect, clearSelection } = useBoardSelection();

  const { jobMap: agentJobMap } = useAgentJobMap(activeBoardId);
  useAgentJobNotifications(agentJobMap);
  const enqueueAgentJob = useEnqueueAgentJob();
  const batchEnqueueAgentJobs = useBatchEnqueueAgentJobs();
  const cancelAgentJob = useCancelAgentJob();
  const resetAiProcessing = useResetAiProcessing();

  // Multi-repo support: fetch repos for the project and manage selected repo state
  const { repos: projectRepos } = useProjectRepos(null);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);

  const handleRepoSelect = useCallback((repoId: string | null) => {
    setSelectedRepoId(repoId);
  }, []);

  const handleImplementWithAi = useCallback(
    (workItemId: string, provider: AgentProvider, codingAgent?: CodingAgent, model?: string) => {
      const context = manualImplementContextById.get(workItemId);
      if (shouldBlockManualImplementForDodHumanReview({
        item: context?.item,
        columnName: context?.columnName,
        columnRole: context?.columnRole,
      })) {
        showToast.warning(
          "This task has failed DoD remediation more than 3 times and needs human review.",
        );
        return;
      }
      const runnerOverride = resolveManualImplementRunnerJob({
        item: context?.item,
        columnName: context?.columnName,
        columnRole: context?.columnRole,
      });
      enqueueAgentJob.mutate({
        workItemId,
        provider,
        codingAgent,
        model,
        ...runnerOverride,
        ...(selectedRepoId ? { repositoryId: selectedRepoId } : {}),
      });
    },
    [enqueueAgentJob, manualImplementContextById, selectedRepoId]
  );

  const handleBatchImplement = useCallback(
    (provider: AgentProvider, codingAgent?: CodingAgent, model?: string) => {
      const workItemIds = Array.from(selectedIds);
      if (workItemIds.length === 0) return;

      batchEnqueueAgentJobs.mutate(
        {
          workItemIds,
          provider,
          codingAgent,
          model,
          ...(selectedRepoId ? { repositoryId: selectedRepoId } : {}),
        },
        {
          onSuccess: () => {
            clearSelection();
          },
        }
      );
    },
    [batchEnqueueAgentJobs, clearSelection, selectedIds, selectedRepoId]
  );

  const {
    pendingWorkItem,
    isDialogOpen: isGenerateDocsOpen,
    isGenerating: isGeneratingDocs,
    promptForDocs,
    confirmGenerate,
    skipGenerate,
  } = useGenerateDocs();

  const [shareBannerVisible, setShareBannerVisible] = useState(false);
  const { source: last7dShareSource, isLoading: isLoadingLast7dShare } =
    useLast7dShareSource(activeBoardId, true);
  const last7dShare = useSprintShare(last7dShareSource);

  const handleDismissShareBanner = useCallback(() => {
    setShareBannerVisible(false);
    if (typeof window === "undefined") return;
    localStorage.setItem(
      getShareCtaStorageKey(activeBoardId),
      String(Date.now())
    );
  }, [activeBoardId]);

  const handleShareFromBanner = useCallback(() => {
    setShareBannerVisible(false);
    if (typeof window !== "undefined") {
      localStorage.setItem(
        getShareCtaStorageKey(activeBoardId),
        String(Date.now())
      );
    }
    last7dShare.openDialog();
  }, [activeBoardId, last7dShare]);

  const handleMovedToDone = useCallback((workItemId: string, workItemTitle: string) => {
    promptForDocs(workItemId, workItemTitle);
    if (shouldShowShareCta(activeBoardId)) {
      setShareBannerVisible(true);
    }
  }, [activeBoardId, promptForDocs]);

  const {
    localColumns,
    activeItem,
    justDroppedIds,
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  } = useWorkItemKanban(activeBoardId, sortedColumns, selectedIds, clearSelection, handleMovedToDone);

  // Map RunnerActionType to agent job parameters
  const RUNNER_ACTION_CONFIG: Record<RunnerActionType, { jobType: AgentJobType; skillName: RunnerSkillName; promptTemplate: string; triggerType: TriggerType; interactive: boolean }> = useMemo(() => ({
    implement: { jobType: "implementation" as const, skillName: "implement" as const, promptTemplate: "implement", triggerType: "event" as const, interactive: false },
    validate: { jobType: "validation" as const, skillName: "validate" as const, promptTemplate: "validate", triggerType: "event" as const, interactive: false },
    fix: { jobType: "bug-fix" as const, skillName: "nightly-fix" as const, promptTemplate: "nightly-fix", triggerType: "event" as const, interactive: false },
    document: { jobType: "implementation" as const, skillName: "document" as const, promptTemplate: "document", triggerType: "event" as const, interactive: false },
  }), []);

  const [runnerActionPendingId, setRunnerActionPendingId] = useState<string | null>(null);

  const handleRunnerAction = useCallback(
    (workItemId: string, provider: AgentProvider, actionType: RunnerActionType, codingAgent?: CodingAgent, model?: string) => {
      const config = RUNNER_ACTION_CONFIG[actionType];
      setRunnerActionPendingId(workItemId);
      enqueueAgentJob.mutate(
        {
          workItemId,
          provider,
          codingAgent,
          model,
          jobType: config.jobType,
          skillName: config.skillName,
          promptTemplate: config.promptTemplate,
          triggerType: config.triggerType,
          interactive: config.interactive,
          ...(selectedRepoId ? { repositoryId: selectedRepoId } : {}),
        },
        {
          onSettled: () => setRunnerActionPendingId(null),
        }
      );
    },
    [enqueueAgentJob, selectedRepoId, RUNNER_ACTION_CONFIG]
  );

  const visibleWorkItemIds = useMemo(
    () => localColumns.flatMap((column) => column.items.map((item) => item.id)),
    [localColumns]
  );
  const participantsQuery = useWorkItemParticipants(visibleWorkItemIds);
  const participantsByItemId = useMemo(
    () => (participantsQuery.data ?? EMPTY_PARTICIPANTS_MAP),
    [participantsQuery.data]
  );

  const {
    form,
    createSheetOpen,
    setCreateSheetOpen,
    createColumnId,
    setCreateColumnId,
    handleCreateItem,
    isCreating,
    availableParents: createParents,
    availableTags: createTags,
    availableProjects: createProjects,
    isLoadingParents: isLoadingCreateParents,
    isLoadingTags: isLoadingCreateTags,
    currentUserName: createCurrentUserName,
    handleAssignToMe: createHandleAssignToMe,
    handleCreateTag: createHandleCreateTag,
    createParentOpen: createCreateParentOpen,
    setCreateParentOpen: setCreateCreateParentOpen,
    handleParentCreated: createHandleParentCreated,
    isFormValid: createIsFormValid,
    pendingFiles,
    handleAddPendingFiles: createHandleAddPendingFiles,
    handleRemovePendingFile: createHandleRemovePendingFile,
    handleAiFormatDescription: createHandleAiFormatDescription,
    handleAiFormatDefinitionOfDone: createHandleAiFormatDefinitionOfDone,
    isAiFormattingDescription: createIsAiFormattingDescription,
    isAiFormattingDefinitionOfDone: createIsAiFormattingDefinitionOfDone,
    watchedType: watchedCreateType,
    availableAssignees: createAvailableAssignees,
    hasActiveTeam: createHasActiveTeam,
    selectedAssigneeIds: createSelectedAssigneeIds,
    onSelectAssignee: createOnSelectAssignee,
    onRemoveAssignee: createOnRemoveAssignee,
  } = useCreateWorkItemForm(activeBoardId, activeBoard, formDefaults);

  // Edit flow now uses the side panel via useWorkItemDetailPanel (no edit dialog)

  // Work item detail panel (slide-over with edit mode)
  const detailPanel = useWorkItemDetailPanel();
  const { openPanel: openParentPanel } = detailPanel;

  // Fetch the project's default AI provider for the currently selected work item
  const detailPanelProjectId = detailPanel.parentItem?.projectId ?? "";
  const { defaultProvider: panelDefaultProvider } = useProjectAiConfig(detailPanelProjectId);

  // Allow global toasts (WebSocketProvider) to open the detail panel without routing.
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ workItemId?: string }>;
      const workItemId = custom.detail?.workItemId;
      if (!workItemId) return;

      const isVisible = localColumns.some((col) =>
        col.items.some((item) => item.id === workItemId)
      );
      if (!isVisible) {
        showToast.warning("Work item is not visible in the current board view.");
        return;
      }

      openParentPanel(workItemId);
    };

    window.addEventListener(OPEN_WORK_ITEM_EVENT, handler as EventListener);
    return () => window.removeEventListener(OPEN_WORK_ITEM_EVENT, handler as EventListener);
  }, [localColumns, openParentPanel]);


  // Dependencies, commits, and documents mutation hooks removed - now handled by PanelAdvancedSections

  // Inline children expansion (uses a separate item than the editing one, keep independent)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const { data: expandedChildrenRaw, isLoading: isLoadingChildren } = useWorkItemChildren(expandedItemId ?? "", !!expandedItemId);
  const expandedChildren = useMemo(() => {
    if (!expandedChildrenRaw) return undefined;
    return expandedChildrenRaw.map((child) => ({
      id: child.id,
      taskId: child.taskId,
      type: child.type,
      title: child.title,
      columnName: child.columnName,
      columnColor: child.columnColor,
    }));
  }, [expandedChildrenRaw]);

  const handleToggleExpand = useCallback((itemId: string) => {
    setExpandedItemId((prev) => (prev === itemId ? null : itemId));
  }, []);

  const handleParentClick = useCallback((parentId: string) => {
    openParentPanel(parentId);
  }, [openParentPanel]);

  const { copyAsPrompt, copyMultipleAsPrompt, activeId: copyingPromptId, successId: copySuccessId } = useCopyAsPrompt();
  const { copied: cliCommandCopied, copyToClipboard: copyCliCommand, getCommand: getCliCommand } = useCopyCliCommand();
  const bulkMove = useBulkMove(activeBoardId);

  // Horizontal scroll indicators for kanban board
  const {
    canScrollLeft: kanbanCanScrollLeft,
    canScrollRight: kanbanCanScrollRight,
    scrollRef: kanbanScrollRef,
  } = useHorizontalScrollIndicators();

  const isDragActive = !!activeItem;

  const handleOpenAddItem = useCallback((columnId: string) => {
    setCreateColumnId(columnId);
    setCreateSheetOpen(true);
  }, [setCreateColumnId, setCreateSheetOpen]);

  const handleItemClick = useCallback((itemId: string) => {
    openParentPanel(itemId);
  }, [openParentPanel]);

  const handleCopyPromptForItem = useCallback((item: PromptCopyItem) => {
    copyAsPrompt({
      id: item.id,
      title: item.title,
      description: item.description ?? "",
      definitionOfDone: (item.metadata?.definitionOfDone as string) ?? "",
    });
  }, [copyAsPrompt]);

  const handleBulkMove = useCallback((columnId: string) => {
    // Resolve parent items (virtual column) to their descendant leaf IDs
    const allItems = localColumns.flatMap((col) => col.items);
    const resolvedIds: string[] = [];
    for (const id of selectedIds) {
      const item = allItems.find((i) => i.id === id);
      if (item?.isVirtualColumn && item.childrenSummary) {
        for (const leafIds of Object.values(item.childrenSummary.leafIdsByColumn)) {
          resolvedIds.push(...leafIds);
        }
      } else {
        resolvedIds.push(id);
      }
    }
    if (resolvedIds.length === 0) return;
    bulkMove.mutate({ workItemIds: resolvedIds, boardColumnId: columnId }, {
      onSuccess: () => clearSelection(),
    });
  }, [selectedIds, bulkMove, clearSelection, localColumns]);

  const handleGenerateCombinedPrompt = useCallback(async () => {
    const items = localColumns
      .filter((col) => col.column.name.toLowerCase() !== "backlog")
      .flatMap((col) => col.items)
      .filter((item) => selectedIds.has(item.id))
      .map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description ?? "",
        definitionOfDone: (item.metadata?.definitionOfDone as string) ?? "",
      }));
    if (items.length === 0) return;
    await copyMultipleAsPrompt(items);
    clearSelection();
  }, [localColumns, selectedIds, copyMultipleAsPrompt, clearSelection]);

  const handleCopyTaskCommand = useCallback((taskId: string) => {
    const command = `/implement ${taskId}`;
    navigator.clipboard.writeText(command)
      .then(() => showToast.success(t("board.copied", { command })))
      .catch(() => showToast.error(t("board.copyError")));
  }, [t]);

  const handleCopyReviewCommand = useCallback((taskId: string) => {
    const command = `/review-task ${taskId}`;
    navigator.clipboard.writeText(command)
      .then(() => showToast.success(t("board.copied", { command })))
      .catch(() => showToast.error(t("board.copyError")));
  }, [t]);

  // CLI command copy for individual card
  const [cliCommandCopiedId, setCliCommandCopiedId] = useState<string | null>(null);
  const cliCopiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopyCliCommandForItem = useCallback((item: CliCommandCopyItem) => {
    copyCliCommand([{
      taskId: item.taskId,
      parentId: item.parentId,
      parentTaskId: item.parentTaskId,
      type: item.type,
    }], t("board.copied", { command: `/implement ${item.taskId}` }));
    setCliCommandCopiedId(item.id);
    if (cliCopiedTimeoutRef.current) clearTimeout(cliCopiedTimeoutRef.current);
    cliCopiedTimeoutRef.current = setTimeout(() => setCliCommandCopiedId(null), 2000);
  }, [copyCliCommand, t]);

  // CLI command for multi-selection
  const selectedCliCommand = useMemo(() => {
    if (selectedIds.size === 0) return null;
    const items = localColumns
      .flatMap((col) => col.items)
      .filter((item) => selectedIds.has(item.id) && item.taskId)
      .map((item) => ({
        taskId: item.taskId,
        parentId: item.parentId,
        parentTaskId: item.parentTaskId,
        type: item.type,
      }));
    return getCliCommand(items);
  }, [selectedIds, localColumns, getCliCommand]);

  const handleCopySelectedCliCommand = useCallback(() => {
    const items = localColumns
      .flatMap((col) => col.items)
      .filter((item) => selectedIds.has(item.id) && item.taskId)
      .map((item) => ({
        taskId: item.taskId,
        parentId: item.parentId,
        parentTaskId: item.parentTaskId,
        type: item.type,
      }));
    if (items.length === 0) return;
    copyCliCommand(items);
  }, [localColumns, selectedIds, copyCliCommand]);

  const handleCopySavedPrompt = useCallback((itemId: string) => {
    const item = localColumns.flatMap(c => c.items).find(i => i.id === itemId);
    const prompt = item?.metadata?.generatedPrompt as string | undefined;
    if (!prompt) return;
    navigator.clipboard.writeText(prompt)
      .then(() => showToast.success(t("board.promptCopied")))
      .catch(() => showToast.error(t("board.copyError")));
  }, [localColumns, t]);

  // watchedCreateType and watchedEditType come from hooks (no duplicate form.watch() here)
  const stableCreateParentCreated = useCallback(
    (parentId: string) => createHandleParentCreated(parentId),
    [createHandleParentCreated]
  );
  const createProjectId = "";
  const createParentDialog = useCreateParentDialog(
    watchedCreateType,
    activeBoardId,
    createProjectId,
    createColumnId,
    stableCreateParentCreated,
    createCurrentUserName
  );

  const createBoardColumns = useMemo(
    () => localColumns.map((col) => col.column),
    [localColumns]
  );

  // CMD+I / Ctrl+I keyboard shortcut to open create dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "i") {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        const isEditable =
          tag === "input" ||
          tag === "textarea" ||
          (e.target as HTMLElement)?.isContentEditable;
        if (isEditable) return;
        if (createSheetOpen || detailPanel.isOpen) return;
        e.preventDefault();
        const firstColumnId = localColumns[0]?.column.id;
        if (firstColumnId) {
          setCreateColumnId(firstColumnId);
          setCreateSheetOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [createSheetOpen, detailPanel.isOpen, localColumns, setCreateColumnId, setCreateSheetOpen]);

  // Stable dialog callbacks
  const isCreateBacklog = useMemo(
    () => localColumns.find(c => c.column.id === createColumnId)?.column.name.toLowerCase() === "backlog",
    [localColumns, createColumnId]
  );
  const handleCreateCopyPrompt = useCallback(() => {
    const values = form.getValues();
    copyAsPrompt({
      title: values.title,
      description: values.description ?? "",
      definitionOfDone: values.definitionOfDone ?? "",
    });
  }, [form, copyAsPrompt]);

  // Determine if the panel item is being processed by AI
  const panelItemId = detailPanel.parentItem?.id ?? null;
  const panelItemJob = panelItemId ? agentJobMap.get(panelItemId) : undefined;
  const panelItem = useMemo(
    () =>
      panelItemId
        ? localColumns.flatMap((col) => col.items).find((item) => item.id === panelItemId) ?? null
        : null,
    [panelItemId, localColumns],
  );
  const isPanelItemAiActive = useMemo(() => {
    if (!panelItemId) return false;
    if (panelItemJob && (panelItemJob.status === "running" || panelItemJob.status === "finalizing" || panelItemJob.status === "queued" || panelItemJob.status === "waiting_for_input" || panelItemJob.status === "paused")) {
      return true;
    }
    return panelItem?.isAiProcessing ?? false;
  }, [panelItemId, panelItemJob, panelItem]);

  const handleStopAi = useMemo(() => {
    if (!isPanelItemAiActive || !panelItemId) return undefined;
    const jobId = panelItemJob?.id;
    if (jobId) {
      return () => cancelAgentJob.mutate(jobId);
    }
    // No active job but isAiProcessing is stuck — allow manual reset
    return () => resetAiProcessing.mutate(panelItemId);
  }, [panelItemJob, isPanelItemAiActive, panelItemId, cancelAgentJob, resetAiProcessing]);

  // Keep the skeleton up while the single-board query is intentionally held for
  // sprint resolution (a disabled query reports isLoading=false), so the board
  // never flashes empty before firing with the correct sprint filter.
  if (isLoading || !isPrefsLoaded || (!area && !isSprintResolved)) {
    return <KanbanBoardSkeleton />;
  }

  return (
    <>
      {shareBannerVisible && (
        <div className="mb-4 max-w-[1200px] mx-auto w-full">
          <ShareProgressBanner
            title={t("board.shareBanner.title")}
            description={t("board.shareBanner.description")}
            shareLabel={t("board.shareBanner.share")}
            dismissLabel={t("board.shareBanner.notNow")}
            closeLabel={t("board.shareBanner.close")}
            onShare={handleShareFromBanner}
            onDismiss={handleDismissShareBanner}
            onClose={handleDismissShareBanner}
          />
        </div>
      )}
      <div className="mb-4 max-w-[1200px] mx-auto w-full">
        <DynamicFilters
          config={baseFiltersConfig}
          appliedFilters={dynamicFilters.appliedFilters}
          onAddFilter={dynamicFilters.addFilter}
          onRemoveFilter={dynamicFilters.removeFilter}
          onUpdateFilter={dynamicFilters.updateFilter}
          onClearFilters={dynamicFilters.clearFilters}
          availableFilters={dynamicFilters.availableFilters}
          searchSlot={
            <div className="flex flex-col flex-1">
              <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={baseFiltersConfig.searchPlaceholder}
                  className="h-8 pl-8 text-sm"
                />
              </div>

              {/* Desktop: inline filter controls */}
              <div className="hidden md:flex md:items-center md:gap-2">
                {!area && sprintOptions.length > 0 && (
                  <Select
                    value={selectedSprintId ?? "__all__"}
                    onValueChange={(value) => setSelectedSprintId(value === "__all__" ? null : value)}
                  >
                    <SelectTrigger
                      size="sm"
                      className={cn(
                        "h-8 text-xs gap-1.5 max-w-[180px]",
                        selectedSprintId && "border-violet-500/50 text-violet-600 dark:text-violet-400 bg-violet-500/10"
                      )}
                    >
                      <CalendarDays className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        selectedSprintId ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"
                      )} />
                      <SelectValue placeholder="Sprint" />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="__all__">{t("kanban.sprintFilter.all")}</SelectItem>
                      {sprintOptions.map((sprint) => (
                        <SelectItem key={sprint.id} value={sprint.id}>
                          {sprint.name}{sprint.isActive ? ` (${t("kanban.sprintFilter.active")})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <SortDropdown
                  options={sortOptions}
                  sortBy={sortBy}
                  sortDirection={sortDirection}
                  onSortChange={setSort}
                  defaultSortBy="manual"
                  defaultSortDirection="asc"
                  ariaLabel={t("kanban.sort.label")}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-8 w-8 p-0",
                        viewMode === "compact" && "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                      )}
                      onClick={handleToggleViewMode}
                      aria-label={viewMode === "compact" ? t("board.viewMode.normal") : t("board.viewMode.compact")}
                    >
                      {viewMode === "compact" ? (
                        <Columns3 className="h-3.5 w-3.5" />
                      ) : (
                        <Rows3 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {viewMode === "compact" ? t("board.viewMode.normal") : t("board.viewMode.compact")}
                  </TooltipContent>
                </Tooltip>
                <SavedViewsContainer
                  boardId={activeBoardId}
                  currentConfig={currentViewConfig}
                  onApplyView={handleApplyView}
                  onRegisterClearActiveView={handleRegisterClearActiveView}
                />
                <AgentActivityContainer boardId={activeBoardId} workItemTitles={workItemTitles} />
                {dynamicFilters.appliedFilters.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      dynamicFilters.clearFilters();
                      clearActiveSavedViewRef.current?.();
                      if (viewMode !== "normal") setViewMode("normal");
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("board.resetFilters")}
                  </Button>
                )}
              </div>

              {/* Mobile: filters button that opens a Sheet */}
              <div className="md:hidden">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {t("board.filters")}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="right" className="w-[300px] overflow-y-auto">
                    <SheetTitle className="sr-only">{t("board.filters")}</SheetTitle>
                    <div className="flex flex-col gap-3 p-4">
                      {!area && sprintOptions.length > 0 && (
                        <Select
                          value={selectedSprintId ?? "__all__"}
                          onValueChange={(value) => setSelectedSprintId(value === "__all__" ? null : value)}
                        >
                          <SelectTrigger
                            size="sm"
                            className={cn(
                              "h-8 text-xs gap-1.5",
                              selectedSprintId && "border-violet-500/50 text-violet-600 dark:text-violet-400 bg-violet-500/10"
                            )}
                          >
                            <CalendarDays className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              selectedSprintId ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"
                            )} />
                            <SelectValue placeholder="Sprint" />
                          </SelectTrigger>
                          <SelectContent align="start">
                            <SelectItem value="__all__">{t("kanban.sprintFilter.all")}</SelectItem>
                            {sprintOptions.map((sprint) => (
                              <SelectItem key={sprint.id} value={sprint.id}>
                                {sprint.name}{sprint.isActive ? ` (${t("kanban.sprintFilter.active")})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <SortDropdown
                        options={sortOptions}
                        sortBy={sortBy}
                        sortDirection={sortDirection}
                        onSortChange={setSort}
                        defaultSortBy="manual"
                        defaultSortDirection="asc"
                        ariaLabel={t("kanban.sort.label")}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-8 text-xs gap-1.5",
                          viewMode === "compact" && "border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                        )}
                        onClick={handleToggleViewMode}
                      >
                        {viewMode === "compact" ? (
                          <>
                            <Columns3 className="h-3.5 w-3.5" />
                            {t("board.viewMode.normal")}
                          </>
                        ) : (
                          <>
                            <Rows3 className="h-3.5 w-3.5" />
                            {t("board.viewMode.compact")}
                          </>
                        )}
                      </Button>
                      <SavedViewsContainer
                        boardId={activeBoardId}
                        currentConfig={currentViewConfig}
                        onApplyView={handleApplyView}
                        onRegisterClearActiveView={handleRegisterClearActiveView}
                      />
                      <AgentActivityContainer boardId={activeBoardId} workItemTitles={workItemTitles} />
                      {dynamicFilters.appliedFilters.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            dynamicFilters.clearFilters();
                            clearActiveSavedViewRef.current?.();
                            if (viewMode !== "normal") setViewMode("normal");
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {t("board.resetFilters")}
                        </Button>
                      )}
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
              </div>

              {/* Mobile: active filter chips displayed below search bar */}
              {(selectedSprintId || viewMode === "compact") && (
                <div className="flex flex-wrap gap-1.5 mt-2 md:hidden">
                  {/* Sprint chip */}
                  {selectedSprintId && (() => {
                    const selectedSprint = sprintOptions.find((s) => s.id === selectedSprintId);
                    return (
                      <Badge
                        variant="secondary"
                        className="h-6 pl-2 pr-1 text-xs gap-1 border-violet-500/50 text-violet-600 dark:text-violet-400 bg-violet-500/10"
                      >
                        <CalendarDays className="h-3 w-3" />
                        <span className="truncate max-w-[120px]">
                          {selectedSprint?.name ?? "Sprint"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedSprintId(null)}
                          className="ml-0.5 rounded-full hover:bg-violet-500/20 p-0.5"
                          aria-label={t("board.clearFilter")}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })()}

                  {/* View mode chip */}
                  {viewMode === "compact" && (
                    <Badge
                      variant="secondary"
                      className="h-6 pl-2 pr-1 text-xs gap-1 border-emerald-500/50 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                    >
                      <Rows3 className="h-3 w-3" />
                      <span>{t("board.viewMode.compact")}</span>
                      <button
                        type="button"
                        onClick={() => setViewMode("normal")}
                        className="ml-0.5 rounded-full hover:bg-emerald-500/20 p-0.5"
                        aria-label={t("board.clearFilter")}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                </div>
              )}
            </div>
          }
        />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* Kanban board with horizontal scroll indicators */}
        <div ref={kanbanScrollRef} className="relative flex-1">
          {/* Left fade gradient indicator */}
          <div
            className={cn(
              "absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none transition-opacity duration-200",
              kanbanCanScrollLeft ? "opacity-100" : "opacity-0"
            )}
            aria-hidden="true"
          />

          <ScrollArea className="w-full whitespace-nowrap h-full">
            <div
              className="flex justify-center gap-4 h-[calc(100vh-185px)] mx-auto w-fit min-w-full px-6"
              style={{ touchAction: "pan-x pan-y" }}
            >
              {localColumns.map((col) => (
                <WorkItemColumn
                  key={col.column.id}
                  compact={viewMode === "compact"}
                  column={col.column}
                  items={col.items}
                  onAddItem={() => handleOpenAddItem(col.column.id)}
                  onItemClick={handleItemClick}
                  onCopyPrompt={handleCopyPromptForItem}
                  onCopySavedPrompt={handleCopySavedPrompt}
                  copyingPromptId={copyingPromptId}
                  copySuccessId={copySuccessId}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onRangeSelect={rangeSelect}
                  activeItemId={activeItem?.id ?? null}
                  justDroppedIds={justDroppedIds}
                  isDragActive={isDragActive}
                  onCopyTaskCommand={handleCopyTaskCommand}
                  onCopyReviewCommand={handleCopyReviewCommand}
                  onCopyCliCommand={handleCopyCliCommandForItem}
                  cliCommandCopiedId={cliCommandCopiedId}
                  agentJobMap={agentJobMap}
                  onImplementWithAi={handleImplementWithAi}
                  isImplementWithAiPending={enqueueAgentJob.isPending}
                  implementingWorkItemId={enqueueAgentJob.variables?.workItemId ?? null}
                  onRunnerAction={handleRunnerAction}
                  runnerActionPendingId={runnerActionPendingId}
                  projectRepos={projectRepos}
                  selectedRepoId={selectedRepoId}
                  onRepoSelect={handleRepoSelect}
                  integrationContext={
                    filterParams?.projectId && selectedRepoId && activeBoardId
                      ? {
                          projectId: filterParams.projectId,
                          repositoryId: selectedRepoId,
                          boardId: activeBoardId,
                        }
                      : undefined
                  }
                  participantsByItemId={participantsByItemId}
                  expandedItemId={expandedItemId}
                  onToggleExpand={handleToggleExpand}
                  expandedChildren={expandedChildren}
                  isLoadingChildren={isLoadingChildren}
                  groupBy={groupBy}
                  collapsedGroups={collapsedGroups}
                  onToggleGroupCollapse={toggleGroupCollapse}
                  onParentClick={handleParentClick}
                />
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>

          {/* Right fade gradient indicator */}
          <div
            className={cn(
              "absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none transition-opacity duration-200",
              kanbanCanScrollRight ? "opacity-100" : "opacity-0"
            )}
            aria-hidden="true"
          />
        </div>

        <DragOverlay dropAnimation={dropAnimationConfig}>
          {activeItem && (() => {
            const isMultiDrag = selectedIds.size > 1 && selectedIds.has(activeItem.id);
            return (
              <div className="relative w-[284px]">
                {isMultiDrag && (
                  <>
                    <div className="absolute inset-0 bg-card border rounded-lg translate-x-2 translate-y-2 opacity-20" />
                    <div className="absolute inset-0 bg-card border rounded-lg translate-x-1 translate-y-1 opacity-40" />
                  </>
                )}
                <div className="relative bg-card border rounded-lg p-3 shadow-lg">
                  <p className="text-sm font-medium">{activeItem.title}</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs mt-1",
                      typeBadgeColors[activeItem.type]
                    )}
                  >
                    {activeItem.type}
                  </Badge>
                </div>
                {isMultiDrag && (
                  <div className="absolute -top-2.5 -right-2.5 bg-primary text-primary-foreground text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center shadow-md">
                    {selectedIds.size}
                  </div>
                )}
              </div>
            );
          })()}
        </DragOverlay>
      </DndContext>

      {/* Create mode dialog */}
      <WorkItemFormDialog
        open={createSheetOpen}
        onOpenChange={setCreateSheetOpen}
        form={form}
        onSubmit={handleCreateItem}
        isPending={isCreating}
        mode="create"
        allowedTypes={activeBoard?.allowedTypes ?? null}
        availableParents={createParents}
        availableTags={createTags}
        availableProjects={createProjects}
        isLoadingParents={isLoadingCreateParents}
        isLoadingTags={isLoadingCreateTags}
        currentUserName={createCurrentUserName}
        onAssignToMe={createHandleAssignToMe}
        onCreateParentOpen={createCreateParentOpen}
        onCreateParentOpenChange={setCreateCreateParentOpen}
        activeBoardId={activeBoardId}
        parentForm={createParentDialog.form}
        onParentSubmit={createParentDialog.handleSubmit}
        isParentPending={createParentDialog.isPending}
        allowedParentTypes={createParentDialog.allowedParentTypes}
        onParentAssignToMe={createParentDialog.handleAssignToMe}
        parentWatchedTitle={createParentDialog.watchedTitle}
        parentWatchedType={createParentDialog.watchedType}
        onFilesDropped={createHandleAddPendingFiles}
        onImageUpload={uploadsApi.uploadImage}
        isFormValid={createIsFormValid}
        onAiFormatDescription={createHandleAiFormatDescription}
        isAiFormattingDescription={createIsAiFormattingDescription}
        onAiFormatDefinitionOfDone={createHandleAiFormatDefinitionOfDone}
        isAiFormattingDefinitionOfDone={createIsAiFormattingDefinitionOfDone}
        onCopyPrompt={isCreateBacklog ? undefined : handleCreateCopyPrompt}
        isCopyingPrompt={copyingPromptId === "__dialog__"}
        showCopySuccess={copySuccessId === "__dialog__"}
        onCreateTag={createHandleCreateTag}
        boardColumns={createBoardColumns}
        currentColumnId={createColumnId}
        onChangeColumn={setCreateColumnId}
        availableAssignees={createAvailableAssignees}
        hasActiveTeam={createHasActiveTeam}
        selectedAssigneeIds={createSelectedAssigneeIds}
        onSelectAssignee={createOnSelectAssignee}
        onRemoveAssignee={createOnRemoveAssignee}
      >
        <PendingFilesSection
          files={pendingFiles}
          onRemove={createHandleRemovePendingFile}
        />
      </WorkItemFormDialog>

      {/* Work item detail slide-over panel */}
      <ParentDetailPanelContainer
        isOpen={detailPanel.isOpen}
        parentItem={detailPanel.parentItem}
        isLoadingParent={detailPanel.isLoadingParent}
        childItems={detailPanel.children}
        isLoadingChildren={detailPanel.isLoadingChildren}
        navigateTo={detailPanel.navigateTo}
        goBack={detailPanel.goBack}
        canGoBack={detailPanel.canGoBack}
        closePanel={detailPanel.closePanel}
        activeTab={detailPanel.activeTab}
        onTabChange={detailPanel.setActiveTab}
        childrenEvents={detailPanel.childrenEvents}
        isLoadingChildrenEvents={detailPanel.isLoadingChildrenEvents}
        showAll={detailPanel.showAll}
        onToggleShowAll={detailPanel.toggleShowAll}
        columnNameById={columnNameById}
        projectNameById={projectNameById}
        onImplementWithAi={detailPanel.parentItem ? (provider, codingAgent, model) => handleImplementWithAi(detailPanel.parentItem!.id, provider, codingAgent, model) : undefined}
        onRunnerAction={detailPanel.parentItem ? (provider, actionType, codingAgent, model) => handleRunnerAction(detailPanel.parentItem!.id, provider, actionType, codingAgent, model) : undefined}
        columnRole={detailPanel.parentItem?.boardColumnId ? localColumns.find(c => c.column.id === detailPanel.parentItem!.boardColumnId)?.column.role ?? null : null}
        onCopyPrompt={detailPanel.parentItem ? () => handleCopyPromptForItem({
          id: detailPanel.parentItem!.id,
          title: detailPanel.parentItem!.title,
          description: detailPanel.parentItem!.description,
          metadata: detailPanel.parentItem!.metadata,
        }) : undefined}
        onCopySavedPrompt={detailPanel.parentItem ? () => handleCopySavedPrompt(detailPanel.parentItem!.id) : undefined}
        onCopyCliCommand={detailPanel.parentItem ? () => handleCopyCliCommandForItem({
          id: detailPanel.parentItem!.id,
          taskId: detailPanel.parentItem!.taskId,
          parentId: detailPanel.parentItem!.parentId,
          parentTaskId: null,
          type: detailPanel.parentItem!.type,
        }) : undefined}
        onCopyReviewCommand={detailPanel.parentItem?.taskId ? () => handleCopyReviewCommand(detailPanel.parentItem!.taskId!) : undefined}
        projectRepos={projectRepos}
        selectedRepoId={selectedRepoId}
        onRepoSelect={handleRepoSelect}
        defaultProvider={panelDefaultProvider ?? undefined}
        isCopyingPrompt={copyingPromptId === detailPanel.parentItem?.id}
        showCopySuccess={copySuccessId === detailPanel.parentItem?.id}
        // Edit mode props
        isEditing={detailPanel.isEditing}
        onToggleEdit={detailPanel.toggleEdit}
        editTitle={detailPanel.editTitle}
        onEditTitleChange={detailPanel.setEditTitle}
        editDescription={detailPanel.editDescription}
        onEditDescriptionChange={detailPanel.setEditDescription}
        editDefinitionOfDone={detailPanel.editDefinitionOfDone}
        onEditDefinitionOfDoneChange={detailPanel.setEditDefinitionOfDone}
        onSave={detailPanel.handleSave}
        isSaving={detailPanel.isSaving}
        onAiFormatDescription={detailPanel.handleAiFormatDescription}
        isAiFormattingDescription={detailPanel.isAiFormattingDescription}
        onAiFormatDefinitionOfDone={detailPanel.handleAiFormatDefinitionOfDone}
        isAiFormattingDefinitionOfDone={detailPanel.isAiFormattingDefinitionOfDone}
        defaultEditMode
        // Metadata editors
        onTypeChange={detailPanel.handleTypeChange}
        onPriorityChange={detailPanel.handlePriorityChange}
        boardColumns={detailPanel.boardColumns}
        currentColumnId={detailPanel.currentColumnId}
        onColumnChange={detailPanel.handleColumnChange}
        availableAssignees={detailPanel.availableAssignees}
        hasActiveTeam={detailPanel.hasActiveTeam}
        selectedAssigneeIds={detailPanel.selectedAssigneeIds}
        onSelectAssignee={detailPanel.handleSelectAssignee}
        onRemoveAssignee={detailPanel.handleRemoveAssignee}
        dueDate={detailPanel.dueDate ? new Date(detailPanel.dueDate) : null}
        onDueDateChange={detailPanel.handleDueDateChange}
        estimatedHours={detailPanel.estimatedHours}
        onEstimatedHoursChange={detailPanel.handleEstimatedHoursChange}
        availableParents={detailPanel.availableParents}
        isLoadingParents={detailPanel.isLoadingParents}
        onParentChange={detailPanel.handleParentChange}
        availableTags={detailPanel.availableTags}
        isLoadingTags={detailPanel.isLoadingTags}
        tagIds={detailPanel.tagIds}
        onTagsChange={detailPanel.handleTagsChange}
        onCreateTag={detailPanel.handleCreateTag}
        isBug={detailPanel.isBug}
        onBugToggle={detailPanel.handleBugToggle}
        // AI processing
        isAiProcessing={isPanelItemAiActive}
        onStopAi={handleStopAi}
        advancedSections={
          detailPanel.parentItem ? (
            <PanelAdvancedSections
              workItemId={detailPanel.parentItem.id}
              projectId={detailPanel.parentItem.projectId}
              pullRequest={(detailPanel.parentItem.metadata as WorkItemMetadata)?.pullRequest ?? null}
              workItem={detailPanel.parentItem}
              workItemType={detailPanel.parentItem.type}
            />
          ) : undefined
        }
        sessionsContent={
          detailPanel.parentItem ? (
            <SessionsTabContainer workItemId={detailPanel.parentItem.id} />
          ) : undefined
        }
      />

      {selectedIds.size > 0 && (
        <SelectionActionBar
          selectedCount={selectedIds.size}
          onGeneratePrompt={handleGenerateCombinedPrompt}
          onClearSelection={clearSelection}
          isGenerating={copyingPromptId === "__multi__"}
          columns={localColumns.map((col) => ({ id: col.column.id, name: col.column.name, color: col.column.color }))}
          onBulkMove={handleBulkMove}
          onBatchImplement={handleBatchImplement}
          isMoving={bulkMove.isPending}
          cliCommand={selectedCliCommand}
          onCopyCliCommand={handleCopySelectedCliCommand}
          cliCommandCopied={cliCommandCopied}
        />
      )}

      <ShareToXDialog
        open={last7dShare.isDialogOpen}
        onOpenChange={last7dShare.setIsDialogOpen}
        draft={last7dShare.draft}
        isPreparing={isLoadingLast7dShare || last7dShare.isPreparing}
        isCopying={last7dShare.isCopying}
        onCopyThread={last7dShare.copyThread}
        onOpenIntent={last7dShare.openIntent}
        isShareAvailable={last7dShare.isShareAvailable}
      />

      <GenerateDocsDialog
        open={isGenerateDocsOpen}
        onOpenChange={(open) => { if (!open) skipGenerate(); }}
        workItemTitle={pendingWorkItem?.title ?? ""}
        onConfirm={confirmGenerate}
        onSkip={skipGenerate}
        isGenerating={isGeneratingDocs}
      />

    </>
  );
};
