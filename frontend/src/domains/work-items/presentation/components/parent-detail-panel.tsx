import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  AlertCircle,
  Users,
  Hash,
  Columns3,
  ClipboardCopy,
  SearchCheck,
  TerminalSquare,
  Pencil,
  X,
  Save,
  CalendarIcon,
  Bug,
  GitBranch,
  Tags,
  Clock,
  StopCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { DescriptionErrorBoundary } from "@/domains/shared/presentation/components/description-error-boundary";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { MarkdownEditorField } from "./markdown-editor-field";
import { ParentHierarchyBreadcrumb } from "./parent-hierarchy-breadcrumb";
import { EventTimeline } from "./event-timeline";
import { ExecutionOriginCard } from "./execution-origin-card";
import { CopyPromptButton } from "./copy-prompt-button";
import { ProviderSelectorPopover } from "@/domains/agents/presentation/components/provider-selector-popover";
import { TypeBadgeSelector } from "./type-badge-selector";
import { StatusBadgeSelector } from "./status-badge-selector";
import { PriorityStarRating } from "./priority-star-rating";
import { ParentSelector } from "./parent-selector";
import { TagMultiSelector } from "./tag-multi-selector";
import { UserMultiSelect } from "@/domains/teams/presentation/components/user-multi-select";
import { isActionAvailable, isActionAvailableByRole, getRunnerActionForRole } from "../../domain/column-actions";
import type { RunnerActionType } from "../../domain/column-actions";
import { isLeafType } from "../../domain/types";
import {
  typeIcons,
  typeBadgeColors,
  priorityColors,
} from "./work-item-style";
import { GroupedDetailProgress } from "./grouped-detail-progress";
import { HierarchyTreeView } from "./hierarchy-tree-view";
import type {
  ParentDetailPanelProps,
  WorkItemMetadata,
  WorkItemEvent,
  WorkItemType,
} from "../../domain/types";

const ALL_TYPES: WorkItemType[] = ["epic", "feature", "story", "task", "idea"];

const FEEDBACK_OUTSIDE_GUARD_SELECTORS = [
  "[data-feedback-widget-trigger]",
  "[data-feedback-widget-content]",
  "[data-chat-feedback-trigger]",
  "[data-chat-feedback-content]",
  "[data-feedback-category-content]",
] as const;

/**
 * Radix outside events are CustomEvents where the clicked element may not be
 * on `event.target`. Radix >=1.1 stores the underlying DOM event under
 * `event.detail.originalEvent`. We check both locations to resolve the actual
 * target that was interacted with.
 */
const resolveOutsideEventTarget = (event: Event): EventTarget | null => {
  if (event.target instanceof Element) {
    return event.target;
  }
  const detail = (event as CustomEvent<{ originalEvent?: Event }>).detail;
  return detail?.originalEvent?.target ?? null;
};

const isFeedbackTarget = (target: EventTarget | null): target is Element =>
  target instanceof Element &&
  FEEDBACK_OUTSIDE_GUARD_SELECTORS.some((selector) =>
    Boolean(target.closest(selector)),
  );

const FIBONACCI_VALUES = [
  { value: "none" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "8", label: "8" },
];

// --- Loading skeleton ---

const LoadingSkeleton = () => (
  <div className="space-y-4 p-6">
    <div className="flex items-center gap-3">
      <Skeleton className="h-6 w-20" />
      <Skeleton className="h-5 w-16" />
    </div>
    <Skeleton className="h-7 w-3/4" />
    <Skeleton className="h-4 w-48" />
    <Skeleton className="h-px w-full" />
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-px w-full" />
    <div className="space-y-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-4 w-40" />
    </div>
    <Skeleton className="h-px w-full" />
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  </div>
);

// --- Children loading skeleton ---

const ChildrenLoadingSkeleton = () => (
  <div className="space-y-2">
    {[1, 2, 3].map((i) => (
      <Skeleton key={i} className="h-10 w-full rounded-md" />
    ))}
  </div>
);

// --- Metadata row ---

const MetadataRow = ({
  icon,
  label,
  children: rowChildren,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-center gap-3 text-sm">
    <span className="text-muted-foreground shrink-0">{icon}</span>
    <span className="text-muted-foreground shrink-0 w-28">{label}</span>
    <span className="flex-1 min-w-0">{rowChildren}</span>
  </div>
);

// --- Group events by taskId for History tab ---

interface EventGroup {
  taskId: string | null;
  events: WorkItemEvent[];
}

const groupEventsByTaskId = (events: WorkItemEvent[]): EventGroup[] => {
  const groups: EventGroup[] = [];
  const seen = new Map<string, EventGroup>();

  for (const event of events) {
    const key = event.taskId ?? "__unknown__";
    if (!seen.has(key)) {
      const group: EventGroup = { taskId: event.taskId ?? null, events: [] };
      seen.set(key, group);
      groups.push(group);
    }
    seen.get(key)!.events.push(event);
  }

  return groups;
};

// --- Main component ---

export const ParentDetailPanel: React.FC<ParentDetailPanelProps> = ({
  open,
  onOpenChange,
  item,
  isLoading,
  ancestors,
  onNavigateToParent,
  children,
  isLoadingChildren,
  onNavigateToChild,
  canGoBack,
  onGoBack,
  activeTab,
  onTabChange,
  childrenEvents,
  isLoadingChildrenEvents,
  ownEvents = [],
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
  // Metadata editors
  onTypeChange,
  onPriorityChange,
  boardColumns,
  currentColumnId,
  onColumnChange,
  availableAssignees,
  hasActiveTeam: hasActiveTeamProp,
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
  onMoveChild,
  executionOriginData,
  advancedSections,
  sessionsContent,
  isAiProcessing,
  onStopAi,
}) => {
  const t = useTranslations("workItems.parentDetail");
  const tCommon = useTranslations("common");
  const tEstimation = useTranslations("estimation");

  const { formatLong, locale } = useFormattedDate();

  const metadata = item?.metadata as WorkItemMetadata | undefined;
  const estimatedPoints = metadata?.estimatedPoints;
  const definitionOfDone = metadata?.definitionOfDone;
  // Aggregated story points from leaf children (for parent items)
  const aggregatedPoints = item?.childrenSummary?.totalEstimatedPoints;

  const eventGroups = groupEventsByTaskId(childrenEvents);

  // Edit mode metadata editing helpers
  const showStatusEditor =
    isEditing &&
    boardColumns &&
    boardColumns.length > 0 &&
    onColumnChange &&
    item &&
    isLeafType(item.type);

  const showAssigneeMultiSelect =
    isEditing &&
    hasActiveTeamProp &&
    availableAssignees &&
    availableAssignees.length > 0 &&
    onSelectAssignee &&
    onRemoveAssignee;

  const showBugToggle =
    isEditing && item?.type === "task" && onBugToggle;

  const handleFeedbackWidgetOutsideEvent = (event: Event) => {
    const target = resolveOutsideEventTarget(event);
    if (isFeedbackTarget(target)) {
      event.preventDefault();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        overlayClassName="z-40"
        onPointerDownOutside={handleFeedbackWidgetOutsideEvent}
        onFocusOutside={handleFeedbackWidgetOutsideEvent}
        onInteractOutside={handleFeedbackWidgetOutsideEvent}
        className="z-40 w-full sm:max-w-xl p-0 flex flex-col overflow-hidden"
      >
        {isLoading ? (
          <LoadingSkeleton />
        ) : !item ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">{t("noItemSelected")}</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <SheetHeader className="space-y-3 p-6 pb-4 pr-12">
              {/* Back button + type badge + taskId row */}
              <div className="flex items-center gap-2">
                {canGoBack && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 cursor-pointer"
                    onClick={onGoBack}
                    aria-label={t("back")}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span className="sr-only">{t("back")}</span>
                  </Button>
                )}

                {/* Type badge: editable in edit mode */}
                {isEditing && onTypeChange ? (
                  <TypeBadgeSelector
                    value={item.type}
                    onChange={onTypeChange}
                    availableTypes={ALL_TYPES}
                  />
                ) : (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs px-2 py-0.5 shrink-0",
                      typeBadgeColors[item.type]
                    )}
                  >
                    {(() => {
                      const TypeIcon = typeIcons[item.type];
                      return <TypeIcon className="h-3 w-3 mr-1" />;
                    })()}
                    {item.type}
                  </Badge>
                )}

                {item.taskId && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {item.taskId}
                  </span>
                )}

                {/* Stop AI button */}
                {isAiProcessing && onStopAi && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 px-2 gap-1.5 text-xs ml-auto shrink-0 cursor-pointer"
                    onClick={onStopAi}
                  >
                    <StopCircle className="h-3.5 w-3.5" />
                    Stop AI
                  </Button>
                )}

                {/* Edit/Cancel toggle */}
                {onToggleEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-7 w-7 shrink-0 cursor-pointer", !(isAiProcessing && onStopAi) && "ml-auto")}
                    onClick={onToggleEdit}
                    aria-label={isEditing ? t("cancelEdit") : t("edit")}
                  >
                    {isEditing ? (
                      <X className="h-4 w-4" />
                    ) : (
                      <Pencil className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>

              {/* Title */}
              {isEditing && onEditTitleChange ? (
                <Input
                  value={editTitle ?? ""}
                  onChange={(e) => onEditTitleChange(e.target.value)}
                  className="text-lg font-semibold leading-snug"
                  autoFocus
                />
              ) : (
                <SheetTitle className="min-w-0 break-words pr-4 text-lg leading-snug">
                  {item.title}
                </SheetTitle>
              )}

              {/* Breadcrumb */}
              {ancestors.length > 0 && (
                <ParentHierarchyBreadcrumb
                  segments={ancestors}
                  onSegmentClick={onNavigateToParent}
                />
              )}

              {/* Progress section (only when item has children) */}
              {children.length > 0 && boardColumns && (() => {
                const doneColumnIds = new Set(
                  boardColumns.filter((c) => c.isDone).map((c) => c.id)
                );
                const doneCount = children.filter(
                  (c) => c.boardColumnId && doneColumnIds.has(c.boardColumnId)
                ).length;
                const totalLeafCount = children.length;
                const progressPercent =
                  totalLeafCount > 0
                    ? Math.round((doneCount / totalLeafCount) * 100)
                    : 0;

                const countPerColumn: Record<string, number> = {};
                const columnColors: Record<string, string> = {};
                const columnNamesMap: Record<string, string> = {};
                for (const c of children) {
                  if (c.boardColumnId) {
                    countPerColumn[c.boardColumnId] =
                      (countPerColumn[c.boardColumnId] ?? 0) + 1;
                  }
                }
                for (const col of boardColumns) {
                  if (countPerColumn[col.id]) {
                    columnColors[col.id] = col.color;
                    columnNamesMap[col.id] = col.name;
                  }
                }

                return (
                  <GroupedDetailProgress
                    progressPercent={progressPercent}
                    doneCount={doneCount}
                    totalLeafCount={totalLeafCount}
                    countPerColumn={countPerColumn}
                    columnColors={columnColors}
                    columnNames={columnNamesMap}
                  />
                );
              })()}

              {/* Action buttons */}
              {item.columnName && (onImplementWithAi || onRunnerAction || onCopyPrompt || onCopySavedPrompt || onCopyCliCommand || onCopyReviewCommand) && (
                <div
                  className="flex items-center gap-1 flex-wrap"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {(columnRole
                    ? isActionAvailableByRole(columnRole, "copy-saved-prompt")
                    : isActionAvailable(item.columnName, "copy-saved-prompt")
                  ) && onCopySavedPrompt && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="h-7 px-2 gap-1.5 text-xs" onClick={onCopySavedPrompt}>
                          <ClipboardCopy className="h-3.5 w-3.5" />
                          Copy Saved Prompt
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy Saved Prompt</TooltipContent>
                    </Tooltip>
                  )}
                  {(columnRole
                    ? isActionAvailableByRole(columnRole, "copy-implement-command")
                    : isActionAvailable(item.columnName, "copy-implement-command")
                  ) && onCopyCliCommand && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="h-7 px-2 gap-1.5 text-xs" onClick={onCopyCliCommand}>
                          <TerminalSquare className="h-3.5 w-3.5" />
                          Copy CLI Command
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy CLI Command</TooltipContent>
                    </Tooltip>
                  )}
                  {(columnRole
                    ? isActionAvailableByRole(columnRole, "implement-with-ai")
                    : isActionAvailable(item.columnName, "implement-with-ai")
                  ) && onImplementWithAi && (
                    <ProviderSelectorPopover
                      onSelect={({ provider, codingAgent, model }) => onImplementWithAi?.(provider, codingAgent, model)}
                      isPending={false}
                      repos={projectRepos}
                      selectedRepoId={selectedRepoId}
                      onRepoSelect={onRepoSelect}
                      defaultProvider={defaultProvider}
                    />
                  )}
                  {/* Generic runner actions: validate, fix, document (role-based) */}
                  {columnRole && onRunnerAction && (() => {
                    const runnerAction = getRunnerActionForRole(columnRole);
                    if (!runnerAction || runnerAction === "implement") return null;
                    const labels: Record<RunnerActionType, string> = {
                      implement: "Implement",
                      validate: "Validate",
                      fix: "Fix",
                      document: "Document",
                    };
                    const label = labels[runnerAction];
                    return (
                      <ProviderSelectorPopover
                        onSelect={({ provider, codingAgent, model }) => onRunnerAction?.(provider, runnerAction, codingAgent, model)}
                        isPending={false}
                        repos={projectRepos}
                        selectedRepoId={selectedRepoId}
                        onRepoSelect={onRepoSelect}
                        actionLabel={label}
                        actionAriaLabel={`${label} with AI`}
                        defaultProvider={defaultProvider}
                      />
                    );
                  })()}
                  {(columnRole
                    ? isActionAvailableByRole(columnRole, "copy-prompt")
                    : isActionAvailable(item.columnName, "copy-prompt")
                  ) && onCopyPrompt && (
                    <CopyPromptButton
                      onCopy={onCopyPrompt}
                      isCopying={isCopyingPrompt ?? false}
                      showSuccess={showCopySuccess}
                      className="h-7 px-2"
                    />
                  )}
                  {(columnRole
                    ? isActionAvailableByRole(columnRole, "ai-review")
                    : isActionAvailable(item.columnName, "ai-review")
                  ) && onCopyReviewCommand && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="h-7 px-2 gap-1.5 text-xs" onClick={onCopyReviewCommand}>
                          <SearchCheck className="h-3.5 w-3.5" />
                          AI Review
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>AI Review</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
            </SheetHeader>

            {/* Tabs: Details / History */}
            <Tabs
              value={activeTab}
              onValueChange={(next) =>
                onTabChange(next as "details" | "history" | "sessions")
              }
              className="flex-1 flex flex-col min-h-0 min-w-0"
            >
              <TabsList className="mx-6 w-auto self-start">
                <TabsTrigger value="details">{t("tabs.details")}</TabsTrigger>
                <TabsTrigger value="history">{t("tabs.history")}</TabsTrigger>
                <TabsTrigger value="sessions">
                  <TerminalSquare className="h-4 w-4 mr-1" />
                  {t("tabs.sessions")}
                </TabsTrigger>
              </TabsList>

              {/* Details tab */}
              <TabsContent
                value="details"
                className="flex-1 min-h-0 min-w-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col"
              >
                <ScrollArea className="flex-1 min-h-0 min-w-0 w-full">
                  <div className="px-6 pb-6 pt-4 space-y-6 min-w-0 w-full overflow-hidden">
                    {/* Description */}
                    <section className="min-w-0 overflow-hidden">
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">
                        {t("description")}
                      </h4>
                      {isEditing && onEditDescriptionChange ? (
                        <MarkdownEditorField
                          value={editDescription ?? ""}
                          onChange={onEditDescriptionChange}
                          height={200}
                          onAiFormat={onAiFormatDescription}
                          isAiFormatting={isAiFormattingDescription}
                        />
                      ) : item.description ? (
                        <DescriptionErrorBoundary key={item.description} fallbackText={item.description}>
                          <MarkdownPreview content={item.description} size="sm" />
                        </DescriptionErrorBoundary>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          {t("noDescription")}
                        </p>
                      )}
                    </section>

                    {/* Separator */}
                    <div className="border-t" />

                    {/* Metadata */}
                    <section>
                      <h4 className="text-sm font-medium text-muted-foreground mb-3">
                        {t("metadata")}
                      </h4>

                      {isEditing ? (
                        /* --- Edit mode: interactive metadata editors --- */
                        <div className="space-y-4">
                          {/* Priority */}
                          <MetadataRow
                            icon={
                              <AlertCircle
                                className={cn("h-4 w-4", priorityColors[item.priority])}
                              />
                            }
                            label={t("priority")}
                          >
                            {onPriorityChange ? (
                              <PriorityStarRating
                                value={item.priority}
                                onChange={onPriorityChange}
                              />
                            ) : (
                              <span className={cn("font-medium capitalize", priorityColors[item.priority])}>
                                {item.priority}
                              </span>
                            )}
                          </MetadataRow>

                          {/* Status (column) - only for leaf types */}
                          {showStatusEditor && (
                            <MetadataRow
                              icon={<Columns3 className="h-4 w-4" />}
                              label={t("status")}
                            >
                              <StatusBadgeSelector
                                columns={boardColumns!}
                                currentColumnId={currentColumnId ?? null}
                                onChangeColumn={onColumnChange!}
                              />
                            </MetadataRow>
                          )}
                          {!showStatusEditor && item.columnName && (
                            <MetadataRow
                              icon={<Columns3 className="h-4 w-4" />}
                              label={t("status")}
                            >
                              <span
                                className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium"
                                style={{
                                  backgroundColor: item.columnColor ? `${item.columnColor}20` : undefined,
                                  color: item.columnColor ?? undefined,
                                }}
                              >
                                {item.columnName}
                              </span>
                            </MetadataRow>
                          )}

                          {/* Assignee */}
                          <MetadataRow
                            icon={<Users className="h-4 w-4" />}
                            label={t("assignee")}
                          >
                            {showAssigneeMultiSelect ? (
                              <UserMultiSelect
                                availableUsers={availableAssignees!}
                                selectedUserIds={selectedAssigneeIds ?? []}
                                onSelect={onSelectAssignee!}
                                onRemove={onRemoveAssignee!}
                              />
                            ) : (
                              <span className={cn(!item.assignee && "text-muted-foreground italic")}>
                                {item.assignee ?? t("unassigned")}
                              </span>
                            )}
                          </MetadataRow>

                          {/* Due Date */}
                          {onDueDateChange && (
                            <MetadataRow
                              icon={<CalendarIcon className="h-4 w-4" />}
                              label={t("dueDate")}
                            >
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className={cn(
                                      "h-8 justify-start text-left font-normal text-xs",
                                      !dueDate && "text-muted-foreground"
                                    )}
                                  >
                                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                                    {dueDate
                                      ? formatLong(dueDate)
                                      : tCommon("selectDate")}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <Calendar
                                    mode="single"
                                    selected={dueDate ?? undefined}
                                    onSelect={(date: Date | undefined) => onDueDateChange(date ?? null)}
                                    initialFocus
                                    locale={locale}
                                  />
                                  {dueDate && (
                                    <div className="px-3 pb-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full text-xs"
                                        onClick={() => onDueDateChange(null)}
                                      >
                                        {tCommon("clear")}
                                      </Button>
                                    </div>
                                  )}
                                </PopoverContent>
                              </Popover>
                            </MetadataRow>
                          )}

                          {/* Estimated Hours */}
                          {onEstimatedHoursChange && (
                            <MetadataRow
                              icon={<Clock className="h-4 w-4" />}
                              label={t("estimatedPoints")}
                            >
                              <Select
                                value={estimatedHours != null ? String(estimatedHours) : "none"}
                                onValueChange={(v) =>
                                  onEstimatedHoursChange(v === "none" ? null : parseFloat(v))
                                }
                              >
                                <SelectTrigger className="h-8 w-28 text-xs">
                                  <SelectValue placeholder={tEstimation("unestimated")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {FIBONACCI_VALUES.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.value === "none" ? tEstimation("unestimated") : opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </MetadataRow>
                          )}

                          {/* Parent */}
                          {onParentChange && availableParents && (
                            <MetadataRow
                              icon={<GitBranch className="h-4 w-4" />}
                              label={t("parent")}
                            >
                              <ParentSelector
                                value={item.parentId ?? undefined}
                                onChange={onParentChange}
                                parents={availableParents}
                                isLoading={isLoadingParents}
                              />
                            </MetadataRow>
                          )}

                          {/* Tags */}
                          {onTagsChange && availableTags && (
                            <MetadataRow
                              icon={<Tags className="h-4 w-4" />}
                              label={t("tags")}
                            >
                              <TagMultiSelector
                                value={tagIds ?? []}
                                onChange={onTagsChange}
                                tags={availableTags}
                                isLoading={isLoadingTags}
                                onCreateTag={onCreateTag}
                              />
                            </MetadataRow>
                          )}

                          {/* Bug flag - only for tasks */}
                          {showBugToggle && (
                            <MetadataRow
                              icon={<Bug className="h-4 w-4" />}
                              label={t("bugFlag")}
                            >
                              <Switch
                                checked={isBug ?? false}
                                onCheckedChange={onBugToggle!}
                              />
                            </MetadataRow>
                          )}
                        </div>
                      ) : (
                        /* --- View mode: read-only metadata --- */
                        <div className="space-y-2.5">
                          <MetadataRow
                            icon={
                              <AlertCircle
                                className={cn("h-4 w-4", priorityColors[item.priority])}
                              />
                            }
                            label={t("priority")}
                          >
                            <span className={cn("font-medium capitalize", priorityColors[item.priority])}>
                              {item.priority}
                            </span>
                          </MetadataRow>

                          <MetadataRow
                            icon={<Columns3 className="h-4 w-4" />}
                            label={t("status")}
                          >
                            <span
                              className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{
                                backgroundColor: item.columnColor ? `${item.columnColor}20` : undefined,
                                color: item.columnColor ?? undefined,
                              }}
                            >
                              {item.columnName}
                            </span>
                          </MetadataRow>

                          <MetadataRow
                            icon={<Users className="h-4 w-4" />}
                            label={t("assignee")}
                          >
                            <span className={cn(!item.assignee && "text-muted-foreground italic")}>
                              {item.assignee ?? t("unassigned")}
                            </span>
                          </MetadataRow>

                          {(estimatedPoints != null || aggregatedPoints != null) && (
                            <MetadataRow
                              icon={<Hash className="h-4 w-4" />}
                              label={t("estimatedPoints")}
                            >
                              <span className="font-medium">
                                {aggregatedPoints != null
                                  ? String(aggregatedPoints)
                                  : String(estimatedPoints)}
                              </span>
                            </MetadataRow>
                          )}
                        </div>
                      )}
                    </section>

                    {/* Definition of Done */}
                    {(isEditing || definitionOfDone) && (
                      <>
                        <div className="border-t" />
                        <section className="min-w-0 overflow-hidden">
                          <h4 className="text-sm font-medium text-muted-foreground mb-2">
                            {t("definitionOfDone")}
                          </h4>
                          {isEditing && onEditDefinitionOfDoneChange ? (
                            <MarkdownEditorField
                              value={editDefinitionOfDone ?? ""}
                              onChange={onEditDefinitionOfDoneChange}
                              height={150}
                              onAiFormat={onAiFormatDefinitionOfDone}
                              isAiFormatting={isAiFormattingDefinitionOfDone}
                            />
                          ) : definitionOfDone ? (
                            <div className="pointer-events-none">
                              <DescriptionErrorBoundary key={definitionOfDone} fallbackText={definitionOfDone}>
                                <MarkdownPreview
                                  content={definitionOfDone}
                                  size="sm"
                                />
                              </DescriptionErrorBoundary>
                            </div>
                          ) : null}
                        </section>
                      </>
                    )}

                    {/* Advanced sections slot */}
                    {advancedSections && (
                      <>
                        <div className="border-t" />
                        <section>{advancedSections}</section>
                      </>
                    )}

                    {/* Children */}
                    <div className="border-t" />
                    <section>
                      <h4 className="text-sm font-medium text-muted-foreground mb-3">
                        {t("children")}
                        {!isLoadingChildren && children.length > 0 && (
                          <span className="ml-1.5 text-xs font-normal">
                            ({t("childrenCount", { count: children.length })})
                          </span>
                        )}
                      </h4>

                      {isLoadingChildren ? (
                        <ChildrenLoadingSkeleton />
                      ) : children.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                          {t("noChildren")}
                        </p>
                      ) : (
                        <HierarchyTreeView
                          items={children}
                          onNavigateToChild={onNavigateToChild}
                          onMoveChild={onMoveChild}
                          boardColumns={boardColumns}
                        />
                      )}
                    </section>

                    {/* Save button */}
                    {isEditing && onSave && (
                      <>
                        <div className="border-t" />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={onToggleEdit}
                            disabled={isSaving}
                          >
                            {t("cancelEdit")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={onSave}
                            disabled={isSaving}
                          >
                            <Save className="h-4 w-4 mr-1.5" />
                            {t("save")}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* History tab */}
              <TabsContent
                value="history"
                className="flex-1 min-h-0 min-w-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col"
              >
                <ScrollArea className="flex-1 min-h-0 min-w-0 w-full">
                  <div className="px-6 pb-6 pt-4 space-y-6 min-w-0 w-full overflow-hidden">
                    {executionOriginData && (executionOriginData.lastOrigin || executionOriginData.activeRun) && (
                      <ExecutionOriginCard
                        lastOrigin={executionOriginData.lastOrigin}
                        activeRun={executionOriginData.activeRun}
                        sessionSummary={executionOriginData.sessionSummary}
                        isLoading={executionOriginData.isLoading}
                      />
                    )}
                    {(isLoadingChildrenEvents || (isLoadingOwnEvents ?? false)) ? (
                      <EventTimeline events={[]} isLoading={true} columnNameById={columnNameById} projectNameById={projectNameById} />
                    ) : (ownEvents.length === 0 && eventGroups.length === 0) ? (
                      <EventTimeline events={[]} isLoading={false} columnNameById={columnNameById} projectNameById={projectNameById} />
                    ) : (
                      <>
                        {/* Own events (this item) */}
                        {ownEvents.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-mono text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                {item?.taskId ?? "This item"}
                              </span>
                              <div className="flex-1 h-px bg-border" />
                            </div>
                            <EventTimeline
                              events={ownEvents}
                              isLoading={false}
                              columnNameById={columnNameById}
                              projectNameById={projectNameById}
                            />
                          </div>
                        )}

                        {/* Children events (grouped by taskId) */}
                        {eventGroups.map((group, index) => (
                          <div key={group.taskId ?? `group-${index}`}>
                            {group.taskId && (
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-mono text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded">
                                  {group.taskId}
                                </span>
                                <div className="flex-1 h-px bg-border" />
                              </div>
                            )}
                            <EventTimeline
                              events={group.events}
                              isLoading={false}
                              columnNameById={columnNameById}
                              projectNameById={projectNameById}
                            />
                          </div>
                        ))}

                        {/* Show all / show less toggle */}
                        <div className="flex justify-center pt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground"
                            onClick={onToggleShowAll}
                          >
                            {showAll
                              ? t("history.showLess")
                              : t("history.showAll")}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Sessions tab */}
              <TabsContent
                value="sessions"
                className="flex-1 min-h-0 min-w-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col"
              >
                <ScrollArea className="flex-1 min-h-0">
                  <div className="px-6 pb-6 pt-4 min-w-0 overflow-hidden">
                    {sessionsContent ?? (
                      <div className="flex flex-col items-center justify-center text-muted-foreground text-sm min-h-[200px]">
                        <TerminalSquare className="h-8 w-8 mb-2 opacity-50" />
                        <p>{t("tabs.sessionsEmpty")}</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
