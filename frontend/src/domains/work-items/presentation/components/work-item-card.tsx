"use client";

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, Bug, ChevronDown, ChevronRight, ClipboardCopy, ExternalLink, GitCommitHorizontal, HelpCircle, Info, Rocket, SearchCheck, ShieldCheck, TerminalSquare, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CopyPromptButton } from "./copy-prompt-button";
import { WorkItemInfoPopup } from "./work-item-info-popup";
import { useIsMobile } from "@/lib/hooks";
import { WorkItemChildrenList } from "./work-item-children-list";
import type { WorkItemChild } from "./work-item-children-list";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentJobIndicator } from "@/domains/agents/presentation/components/agent-job-indicator";
import { ProviderSelectorPopover } from "@/domains/agents/presentation/components/provider-selector-popover";
import {
  AI_PROVIDER_LABELS,
  normalizeAiProvidersFromMetadata,
  getReservedAiProviderFromMetadata,
  mapAgentProviderToNormalized,
} from "@/domains/shared/presentation/utils/provider-icons";
import type { NormalizedProvider } from "@/domains/shared/presentation/utils/provider-icons";
import type { ColumnRole } from "@/domains/boards/domain/types";
import type { AgentJobStatus, AgentProvider, RepoOption } from "@/domains/agents/domain/types";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import type { AiParticipant, AiParticipantProvider, ParticipantOrAi, WorkItemParticipant, WorkItemWithContext, WorkItemMetadata } from "../../domain/types";
import { parseChecklistStatus } from "../../domain/types";
import type { RunnerActionType } from "../../domain/column-actions";
import { isActionAvailable, isActionAvailableByRole, getRunnerActionForRole } from "../../domain/column-actions";
import { resolveExternalValidationRequirement, resolveHumanActionRequirement } from "../../domain/runner-action-resolution";
import { stripTitlePrefix } from "../../domain/title-utils";
import { priorityColors, priorityIcons, typeBadgeColors } from "./work-item-style";
import { ParticipantAvatars } from "./participant-avatars";
import { GroupedCardProgress } from "./grouped-card-progress";
import { GitHubStatusBadge } from "./github-status-badge";
import { UserActionsChecklistContainer } from "../containers/user-actions-checklist-container";
import { AggregatedUserActionsChecklistContainer } from "../containers/aggregated-user-actions-checklist-container";
import { TShirtBadge } from "./tshirt-badge";
import { pointsToTShirtSize } from "../../domain/utils";
import { HumanActionRequiredBadge } from "./human-action-required-badge";

export { typeBadgeColors, priorityColors };

/** ReactMarkdown components that render everything inline for line-clamp compatibility.
 *  Factory so each render gets a fresh heading counter (line break from 2nd heading onward). */
const createInlineMarkdownComponents = () => {
  let headingCount = 0;
  const heading = ({ children }: { children?: React.ReactNode }) => {
    headingCount++;
    return headingCount > 1
      ? <><br /><span className="font-semibold text-foreground">{children}: </span></>
      : <span className="font-semibold text-foreground">{children}: </span>;
  };
  return {
    p: ({ children }: { children?: React.ReactNode }) => <>{children} </>,
    h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading,
    ul: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    ol: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    li: ({ children }: { children?: React.ReactNode }) => <>{children} </>,
    blockquote: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    code: ({ children }: { children?: React.ReactNode }) => <span className="text-primary">{children}</span>,
    a: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    strong: ({ children }: { children?: React.ReactNode }) => <span className="font-semibold">{children}</span>,
    em: ({ children }: { children?: React.ReactNode }) => <span className="italic">{children}</span>,
    br: () => <> </>,
    hr: () => null,
    img: () => null,
  };
};


const getUserActionsFromMetadata = (
  metadata: Record<string, unknown> | null | undefined
): string | null => {
  // Prioritize deployChecklist over userActions for backward compatibility
  const deploy = metadata?.deployChecklist;
  if (typeof deploy === "string" && deploy.trim().length > 0) return deploy.trim();
  const value = metadata?.userActions;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isDoneColumn = (columnName: string): boolean => /done|hecho|completed/i.test(columnName);
const isAtOrAfterReviewColumn = (columnName: string): boolean =>
  /review|testing|validating|done|hecho|completed|approved/i.test(columnName);

const getPositiveStoryPoints = (item: WorkItemWithContext): number | null => {
  const storyPoints =
    item.childrenSummary?.totalEstimatedPoints ??
    ((item.metadata as WorkItemMetadata | undefined)?.estimatedPoints ?? undefined);

  return typeof storyPoints === "number" && storyPoints > 0 ? storyPoints : null;
};

const DefinitionOfDoneApprovedBadge = ({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-green-500 text-white shadow-sm ring-1 ring-green-400/40",
          compact ? "h-3.5 w-3.5" : "h-4 w-4",
        )}
        aria-label={label}
      >
        <Check className={cn(compact ? "h-2.5 w-2.5" : "h-3 w-3")} strokeWidth={3} />
      </span>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

const ExternalValidationRequiredBadge = ({
  label,
  message,
  tools,
  compact = false,
}: {
  label: string;
  message: string;
  tools: string[];
  compact?: boolean;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-sky-500 text-white shadow-sm ring-1 ring-sky-400/50",
          compact ? "h-3.5 w-3.5" : "h-4 w-4",
        )}
        aria-label={label}
      >
        <SearchCheck className={cn(compact ? "h-2.5 w-2.5" : "h-3 w-3")} strokeWidth={3} />
      </span>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs space-y-1">
      <p className="text-xs font-semibold">{label}</p>
      <p className="text-xs text-muted-foreground">{message}</p>
      {tools.length > 0 && (
        <p className="text-[11px] text-muted-foreground">{tools.join(" · ")}</p>
      )}
    </TooltipContent>
  </Tooltip>
);


/** Build AI pseudo-participants from the item's AI metadata and agent job state. */
const buildAiParticipants = (
  aiProviders: AiParticipantProvider[],
  isAiReserved: boolean,
  reservedProvider: AiParticipantProvider,
  shouldAnimateMetadataProviders: boolean,
  hasActiveAgentJob: boolean,
  agentJobProvider: AgentProvider | undefined,
  isTodoOrInProgressColumn: boolean,
  showAgentIcons: boolean,
): AiParticipant[] => {
  const seen = new Set<AiParticipantProvider>();
  const result: AiParticipant[] = [];

  const addProvider = (provider: AiParticipantProvider, processing: boolean) => {
    if (seen.has(provider)) return;
    seen.add(provider);
    result.push({
      kind: "ai",
      provider,
      label: AI_PROVIDER_LABELS[provider],
      isProcessing: processing,
    });
  };

  // Reserved AI icon (todo/in-progress columns)
  if (isAiReserved && isTodoOrInProgressColumn) {
    addProvider(reservedProvider, true);
  }

  // Active agent job provider
  if (hasActiveAgentJob && agentJobProvider) {
    const mapped = mapAgentProviderToNormalized(agentJobProvider) as AiParticipantProvider;
    addProvider(mapped, true);
  }

  // AI providers from metadata (review+ columns or any context)
  if (showAgentIcons || isTodoOrInProgressColumn) {
    for (const provider of aiProviders) {
      addProvider(provider, shouldAnimateMetadataProviders);
    }
  }

  // Fallback: isAiProcessing with no provider info
  if (shouldAnimateMetadataProviders && result.length === 0) {
    addProvider("other", true);
  }

  return result;
};

interface WorkItemCardProps {
  item: WorkItemWithContext;
  columnName: string;
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

const RUNNER_ACTION_LABELS: Record<RunnerActionType, string> = {
  implement: "Implement",
  validate: "Validate",
  fix: "Fix",
  document: "Document",
};

const WorkItemCardInner: React.FC<WorkItemCardProps> = ({
  item,
  columnName,
  columnRole,
  compact,
  agentJobStatus,
  agentJobProvider,
  onImplementWithAi,
  isImplementWithAiPending,
  onRunnerAction,
  isRunnerActionPending,
  projectRepos,
  selectedRepoId,
  onRepoSelect,
  defaultProvider,
  participants = [],
  onClick,
  onCopyPrompt,
  onCopySavedPrompt,
  isCopyingPrompt,
  showCopySuccess,
  isSelected,
  onToggleSelect,
  onRangeSelect,
  isGroupedForDrag,
  isJustDropped,
  isDragActive,
  onCopyTaskCommand,
  onCopyReviewCommand,
  onCopyCliCommand,
  cliCommandCopied,
  isExpanded,
  onToggleExpand,
  childrenItems,
  isLoadingChildren,
  onParentClick,
  columnNamesById,
  columnColorsById,
}) => {
  const t = useTranslations("workItems");
  const tAgents = useTranslations("agents");
  const isMobile = useIsMobile();
  const aiProviders = normalizeAiProvidersFromMetadata(item.metadata as Record<string, unknown> | undefined);
  const userActions = getUserActionsFromMetadata(item.metadata as Record<string, unknown> | undefined);
  const isDeployChecklist = !!(item.metadata as Record<string, unknown> | undefined)?.deployChecklist && userActions === ((item.metadata as Record<string, unknown> | undefined)?.deployChecklist as string)?.trim();
  const isAiReserved = (item.metadata as WorkItemMetadata | undefined)?.aiReserved === true;
  const reservedProvider = getReservedAiProviderFromMetadata(item.metadata as WorkItemMetadata | undefined);
  const lastAiError = (item.metadata as Record<string, unknown> | undefined)?.lastAiError as { message: string; type?: string; at: string; jobId?: string } | undefined;
  const hasAiError = !!lastAiError && !item.isAiProcessing;
  const aggregatedUserActions = item.childrenSummary?.childUserActions;
  const hasAggregatedUserActions = !!aggregatedUserActions && aggregatedUserActions.length > 0;
  const showUserActions = (!!userActions || hasAggregatedUserActions) && !isDoneColumn(columnName);
  // Compute checklist status for visual indicator (only for per-item userActions, not aggregated)
  const checklistStatus = userActions ? parseChecklistStatus(item.metadata as WorkItemMetadata) : null;
  const showAgentIcons = isAtOrAfterReviewColumn(columnName);
  const isTodoOrInProgressColumn = /to do|todo|progress|doing|en progreso/i.test(columnName);
  const hasActiveAgentJob = agentJobStatus === "queued" || agentJobStatus === "running" || agentJobStatus === "finalizing" || agentJobStatus === "waiting_for_input" || agentJobStatus === "paused";
  const isWaitingForInput = agentJobStatus === "waiting_for_input";
  const shouldAnimateMetadataProviders = hasActiveAgentJob || item.isAiProcessing;

  const isAiActive = (
    (isAiReserved && isTodoOrInProgressColumn) ||
    hasActiveAgentJob ||
    item.isAiProcessing
  );

  // Build AI pseudo-participants and combine with human participants (humans first, AI after)
  const aiParticipants = buildAiParticipants(
    aiProviders,
    isAiReserved,
    reservedProvider,
    shouldAnimateMetadataProviders,
    hasActiveAgentJob,
    agentJobProvider,
    isTodoOrInProgressColumn,
    showAgentIcons,
  );
  const combinedParticipants: ParticipantOrAi[] = [...participants, ...aiParticipants];
  const hasBottomAvatars = !!item.createdBy || combinedParticipants.length > 0;
  const isDodApproved = (item.metadata as WorkItemMetadata | undefined)?.dod_approved === true;
  const directHumanActionRequirement = resolveHumanActionRequirement(item.metadata as WorkItemMetadata | undefined);
  const childHumanActionRequirements = item.childrenSummary?.childHumanActionRequirements ?? [];
  const humanActionRequirement = directHumanActionRequirement.required
    ? directHumanActionRequirement
    : childHumanActionRequirements.length > 0
      ? { required: true, message: childHumanActionRequirements[0]?.message ?? null }
      : directHumanActionRequirement;
  const humanActionMessage =
    humanActionRequirement.message ?? t("card.humanActionRequiredFallback");
  const humanActionRequirements = directHumanActionRequirement.required
    ? [{
        itemId: item.id,
        taskId: item.taskId,
        message: humanActionMessage,
      }]
    : childHumanActionRequirements.map((requirement) => ({
        itemId: requirement.itemId,
        taskId: requirement.taskId,
        message: requirement.message || t("card.humanActionRequiredFallback"),
      }));
  const directExternalValidationRequirement = resolveExternalValidationRequirement(
    item.metadata as WorkItemMetadata | undefined,
  );
  const childExternalValidationRequirements = childHumanActionRequirements.filter(
    (requirement) => requirement.externalValidationRequired === true,
  );
  const childExternalValidationTools = Array.from(new Set(
    childExternalValidationRequirements.flatMap((requirement) => requirement.externalValidationTools ?? []),
  ));
  const externalValidationRequirement = directExternalValidationRequirement.required
    ? directExternalValidationRequirement
    : childExternalValidationRequirements.length > 0
      ? {
          required: true,
          message: childExternalValidationRequirements[0]?.message ?? null,
          tools: childExternalValidationTools,
        }
      : directExternalValidationRequirement;
  const externalValidationMessage =
    externalValidationRequirement.message ?? t("card.externalValidationRequiredFallback");

  const agentBorderProvider = agentJobProvider || reservedProvider ||
    (aiProviders.includes("openai") ? "openai" :
     aiProviders.includes("anthropic") ? "anthropic" :
     aiProviders.length > 0 ? "other" : null);

  const isAgentQueued = isAiActive && /to do|todo/i.test(columnName);

  const agentBorderClass = isAiActive ? cn(
    "ai-agent-border",
    isAgentQueued && "ai-agent-border--queued",
    isWaitingForInput && "ai-agent-border--waiting",
    isWaitingForInput ? "ai-agent-border--waiting-color"
      : agentBorderProvider === "openai" ? "ai-agent-border--openai"
      : agentBorderProvider === "anthropic" ? "ai-agent-border--anthropic"
      : agentBorderProvider === "zai" ? "ai-agent-border--zai"
      : "ai-agent-border--default"
  ) : undefined;

  const aiErrorBorderClass = hasAiError && !isAiActive ? "ring-2 ring-red-400/50" : undefined;

  const isAutoPositioned = item.isVirtualColumn;
  const isGroupedCard = isAutoPositioned && !!item.childrenSummary;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { item },
    disabled: isAiActive,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="border-2 border-dashed border-primary/30 rounded-lg bg-primary/5 opacity-40"
        {...attributes}
        {...listeners}
      >
        <div className="invisible flex overflow-hidden">
          {item.projectColor && <div className="w-1.5 shrink-0 self-stretch" />}
          <div className="flex-1 px-3 pb-3 space-y-2 min-w-0">
            {(item.projectName || item.taskId) && <span className="text-[10px] block pt-1.5">&nbsp;</span>}
            <div className="mt-3"><p className="text-sm font-medium">{item.title}</p></div>
            {item.description && <div className="text-xs line-clamp-4">{item.description}</div>}
            <div className="text-xs">&nbsp;</div>
            {item.tags.length > 0 && <div className="text-xs">&nbsp;</div>}
          </div>
        </div>
      </div>
    );
  }

  if (isGroupedForDrag) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="bg-card border border-dashed rounded-lg p-3 opacity-30 scale-[0.97] ring-2 ring-primary/30 transition-all duration-300 select-none"
        {...attributes}
        {...listeners}
      >
        <p className="text-sm font-medium truncate">{item.title}</p>
      </div>
    );
  }

  if (compact) {
    const pr = (item.metadata as WorkItemMetadata)?.pullRequest;
    const hasPr = !!pr && pr.state !== "closed";
    const ciStatus = (item.metadata as WorkItemMetadata)?.ciStatus;
    const hasCiStatus = !!ciStatus;
    const hasBug = (item.metadata as WorkItemMetadata)?.isBug === true;
    const hasTested = (item.metadata as WorkItemMetadata)?.tested === true;
    const isDodApproved = (item.metadata as WorkItemMetadata)?.dod_approved === true;
    const hasPreview = !!(item.metadata as WorkItemMetadata)?.previewUrl;
    const hasPriority = !!item.priority;
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "group relative bg-card border rounded-md hover:shadow-sm transition-shadow flex overflow-hidden select-none",
          isAiActive || isAutoPositioned ? "cursor-default" : "cursor-pointer",
          isSelected && "ring-2 ring-blue-500 border-blue-500",
          isJustDropped && "animate-kanban-ungroup",
          agentBorderClass,
          isAiActive && "border-transparent",
          isGroupedCard && "border-muted-foreground/40 bg-muted/10",
          aiErrorBorderClass
        )}
        onClick={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.shiftKey && onRangeSelect) {
            e.preventDefault();
            onRangeSelect();
          } else if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
            e.preventDefault();
            onToggleSelect();
          } else {
            onClick?.();
          }
        }}
        {...attributes}
        {...listeners}
      >
        {item.projectColor && (
          <div
            className="w-1 shrink-0 self-stretch rounded-l-md"
            style={{ backgroundColor: item.projectColor }}
          />
        )}
        <div className="flex-1 min-w-0 px-2 py-1.5 space-y-0.5">
          {/* Row 1: Task ID + right slot (avatars normally, action icons on hover) */}
          <div className="flex items-center gap-1 min-w-0 h-5">
            {item.taskId && (
              <span
                className="text-[10px] font-mono font-semibold shrink-0"
                style={{ color: item.projectColor ?? undefined }}
              >
                {item.taskId}
              </span>
            )}
            {item.taskId && item.projectName && <span className="text-[10px] shrink-0" style={{ color: item.projectColor ?? undefined }}>|</span>}
            {item.projectName && (
              <span className="text-[10px] truncate min-w-0" style={{ color: item.projectColor ?? undefined }}>
                {item.projectName}
              </span>
            )}
            {isDodApproved && (
              <DefinitionOfDoneApprovedBadge
                label={t("card.definitionOfDoneApproved")}
                compact
              />
            )}
            {humanActionRequirement.required && (
              <HumanActionRequiredBadge
                label={t("card.humanActionRequired")}
                actionLabel={t("card.humanActionRequiredAction")}
                message={humanActionMessage}
                requirements={humanActionRequirements}
                compact
              />
            )}
            {externalValidationRequirement.required && (
              <ExternalValidationRequiredBadge
                label={t("card.externalValidationRequired")}
                message={externalValidationMessage}
                tools={externalValidationRequirement.tools}
                compact
              />
            )}
            {/* Right slot: swap avatars ↔ actions via a single relative container */}
            <div className="ml-auto shrink-0 relative">
              {/* Avatars — visible by default, hidden on hover (or hidden on mobile when actions are visible) */}
              {(combinedParticipants.length > 0 || item.createdBy) && (
                <div className={cn("flex items-center transition-opacity duration-150", !isAiActive && "group-hover:opacity-0")}>
                  <ParticipantAvatars
                    participants={combinedParticipants.slice(0, 2)}
                    maxVisible={2}
                    creator={item.createdBy}
                  />
                </div>
              )}
              {/* Action icons — hidden by default, visible on hover (absolutely positioned over avatars) */}
              {!isAiActive && (
                <div
                  className="absolute top-0 right-0 flex items-center gap-0.5 h-full touch-visible"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {isActionAvailable(columnName, "copy-implement-command") && onCopyCliCommand && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-xs" className="shrink-0" onClick={onCopyCliCommand} aria-label={t("card.copyImplementCommand")}>
                          {cliCommandCopied ? <Check className="h-3 w-3 text-green-500" /> : <TerminalSquare className="h-3 w-3 text-muted-foreground" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("card.copyImplementCommand")}</TooltipContent>
                    </Tooltip>
                  )}
                  {(columnRole
                    ? isActionAvailableByRole(columnRole, "implement-with-ai")
                    : isActionAvailable(columnName, "implement-with-ai")
                  ) && onImplementWithAi && !hasActiveAgentJob && (
                    <ProviderSelectorPopover
                      onSelect={({ provider, codingAgent, model }) => onImplementWithAi?.(provider, codingAgent, model)}
                      isPending={isImplementWithAiPending}
                      repos={projectRepos}
                      selectedRepoId={selectedRepoId}
                      onRepoSelect={onRepoSelect}
                      defaultProvider={defaultProvider}
                    />
                  )}
                  {columnRole && onRunnerAction && !hasActiveAgentJob && (() => {
                    const runnerAction = getRunnerActionForRole(columnRole);
                    if (!runnerAction || runnerAction === "implement") return null;
                    const label = RUNNER_ACTION_LABELS[runnerAction];
                    return (
                      <ProviderSelectorPopover
                        onSelect={({ provider, codingAgent, model }) => onRunnerAction?.(provider, runnerAction, codingAgent, model)}
                        isPending={isRunnerActionPending}
                        repos={projectRepos}
                        selectedRepoId={selectedRepoId}
                        onRepoSelect={onRepoSelect}
                        actionLabel={label}
                        actionAriaLabel={`${label} with AI`}
                        defaultProvider={defaultProvider}
                      />
                    );
                  })()}
                  {isActionAvailable(columnName, "copy-prompt") && onCopyPrompt && (
                    <CopyPromptButton
                      onCopy={onCopyPrompt}
                      isCopying={isCopyingPrompt ?? false}
                      showSuccess={showCopySuccess}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
          {/* Row 2: Status indicators + title */}
          <div className="flex items-center gap-1.5 min-w-0">
            {hasPriority && (() => {
              const PriorityIcon = priorityIcons[item.priority];
              return <PriorityIcon className={cn("h-3.5 w-3.5 shrink-0", priorityColors[item.priority])} />;
            })()}
            {(() => {
              const storyPoints = getPositiveStoryPoints(item);
              if (storyPoints === null) return null;

              const tshirtSize = pointsToTShirtSize(storyPoints);
              if (!tshirtSize) return null;

              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0">
                      <TShirtBadge size={tshirtSize} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t("card.storyPoints", { points: storyPoints })}</TooltipContent>
                </Tooltip>
              );
            })()}
            {hasBug && (
              <span className="text-red-500 shrink-0"><Bug className="h-3 w-3" /></span>
            )}
            {hasTested && (
              <span className="text-green-500 shrink-0"><ShieldCheck className="h-3 w-3" /></span>
            )}
            {hasPreview && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={(item.metadata as WorkItemMetadata).previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="text-blue-500 hover:text-blue-600 transition-colors shrink-0"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>{t("card.previewDeployment")}</TooltipContent>
              </Tooltip>
            )}
            {(hasPr || hasCiStatus) && (
              <GitHubStatusBadge pullRequest={pr} ciStatus={ciStatus} size="sm" />
            )}
            {(() => {
              const release = (item.metadata as WorkItemMetadata)?.releasePullRequest;
              if (!release || release.state === "closed") return null;
              const isMerged = release.state === "merged";
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={release.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      className={cn(
                        "shrink-0 transition-colors",
                        isMerged
                          ? "text-purple-500 hover:text-purple-600"
                          : "text-blue-500 hover:text-blue-600",
                      )}
                      aria-label={t("card.releasePr", { number: release.releaseNumber })}
                    >
                      <Rocket className="h-3 w-3" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("card.releasePr", { number: release.releaseNumber })}
                    {isMerged ? ` · ${t("card.releaseMerged")}` : ` · ${t("card.releaseOpen")}`}
                  </TooltipContent>
                </Tooltip>
              );
            })()}
            {showUserActions && (
              <Tooltip delayDuration={500}>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "relative inline-flex shrink-0 cursor-pointer",
                      checklistStatus?.hasIncomplete
                        ? "text-amber-500"
                        : checklistStatus && !checklistStatus.hasIncomplete
                        ? "text-green-500"
                        : "text-blue-500"
                    )}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <Info className="h-3 w-3" />
                    {checklistStatus?.hasIncomplete && (
                      <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-amber-500 text-[8px] text-white font-bold leading-none px-0.5">
                        {checklistStatus.uncheckedItems.length}/{checklistStatus.totalItems}
                      </span>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left" align="start" className="w-72 max-h-[70vh] overflow-y-auto bg-popover text-popover-foreground border rounded-lg p-3 shadow-lg space-y-1.5">
                  <p className="text-[11px] font-semibold">{t(isDeployChecklist ? "card.deployChecklistTitle" : "card.userActionsTitle")}</p>
                  {userActions ? (
                    <UserActionsChecklistContainer
                      itemId={item.id}
                      metadata={item.metadata as WorkItemMetadata}
                      userActions={userActions}
                    />
                  ) : hasAggregatedUserActions ? (
                    <AggregatedUserActionsChecklistContainer entries={aggregatedUserActions!} />
                  ) : null}
                </TooltipContent>
              </Tooltip>
            )}
            {hasAiError && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-red-500 shrink-0"><AlertTriangle className="h-3 w-3" /></span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs bg-[oklch(0.25_0.13_25)] border border-[oklch(0.38_0.14_25)] text-[oklch(0.88_0.18_25)]">
                  <p className="text-xs font-medium">AI Error{lastAiError!.type ? ` (${lastAiError!.type})` : ""}</p>
                  <p className="text-xs text-red-400/70">{lastAiError!.message}</p>
                </TooltipContent>
              </Tooltip>
            )}
            <span className="text-sm font-medium truncate min-w-0">{stripTitlePrefix(item.title)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative bg-card border rounded-lg hover:shadow-sm transition-shadow flex flex-col overflow-hidden whitespace-normal select-none",
        isAiActive || isAutoPositioned ? "cursor-default" : "cursor-pointer",
        isSelected && "ring-2 ring-blue-500 border-blue-500",
        isJustDropped && "animate-kanban-ungroup",
        agentBorderClass,
        isAiActive && "border-transparent",
        isGroupedCard && "border-muted-foreground/40 bg-muted/10",
        aiErrorBorderClass
      )}
      onClick={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && onRangeSelect) {
          e.preventDefault();
          onRangeSelect();
        } else if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
          e.preventDefault();
          onToggleSelect();
        } else {
          onClick?.();
        }
      }}
      {...attributes}
      {...listeners}
    >
      <div className="flex overflow-hidden">
      {/* Action icons - absolute top right (hidden when AI is actively processing) */}
      {!isAiActive && (
        <div
          className="absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 touch-visible"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {isActionAvailable(columnName, "copy-saved-prompt") && onCopySavedPrompt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  onClick={onCopySavedPrompt}
                  aria-label={t("card.copySavedPrompt")}
                >
                  <ClipboardCopy className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("card.copySavedPrompt")}</TooltipContent>
            </Tooltip>
          )}
          {isActionAvailable(columnName, "copy-implement-command") && onCopyCliCommand && (
            <Tooltip>
              <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0"
                    onClick={onCopyCliCommand}
                    aria-label={t("card.copyImplementCommand")}
                  >
                  {cliCommandCopied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <TerminalSquare className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("card.copyImplementCommand")}</TooltipContent>
            </Tooltip>
          )}
          {/* Implement with AI (legacy name-based or role-based) */}
          {(columnRole
            ? isActionAvailableByRole(columnRole, "implement-with-ai")
            : isActionAvailable(columnName, "implement-with-ai")
          ) && onImplementWithAi && !hasActiveAgentJob && (
            <ProviderSelectorPopover
              onSelect={({ provider, codingAgent, model }) => onImplementWithAi?.(provider, codingAgent, model)}
              isPending={isImplementWithAiPending}
              repos={projectRepos}
              selectedRepoId={selectedRepoId}
              onRepoSelect={onRepoSelect}
              defaultProvider={defaultProvider}
            />
          )}
          {/* Generic runner actions: validate, fix, document (role-based only) */}
          {columnRole && onRunnerAction && !hasActiveAgentJob && (() => {
            const runnerAction = getRunnerActionForRole(columnRole);
            if (!runnerAction || runnerAction === "implement") return null;
            const label = RUNNER_ACTION_LABELS[runnerAction];
            return (
              <ProviderSelectorPopover
                onSelect={({ provider, codingAgent, model }) => onRunnerAction?.(provider, runnerAction, codingAgent, model)}
                isPending={isRunnerActionPending}
                repos={projectRepos}
                selectedRepoId={selectedRepoId}
                onRepoSelect={onRepoSelect}
                actionLabel={label}
                actionAriaLabel={`${label} with AI`}
                defaultProvider={defaultProvider}
              />
            );
          })()}
          {isActionAvailable(columnName, "copy-prompt") && onCopyPrompt && (
            <CopyPromptButton
              onCopy={onCopyPrompt}
              isCopying={isCopyingPrompt ?? false}
              showSuccess={showCopySuccess}
            />
          )}
          {isActionAvailable(columnName, "ai-review") && onCopyReviewCommand && (
            <Tooltip>
              <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0"
                    onClick={onCopyReviewCommand}
                    aria-label={t("card.copyReviewCommand")}
                  >
                    <SearchCheck className="h-4 w-4 text-muted-foreground" />
                  </Button>
              </TooltipTrigger>
              <TooltipContent>{t("card.copyReviewCommand")}</TooltipContent>
            </Tooltip>
          )}
          {isActionAvailable(columnName, "info-popup") && item.type === "task" && (
            isDragActive ? (
              <span className="cursor-pointer">
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </span>
            ) : (
              <WorkItemInfoPopup
                title={item.title}
                description={item.description}
                definitionOfDone={(item.metadata?.definitionOfDone as string) ?? null}
              >
                <span className="cursor-pointer">
                  <HelpCircle className="h-4 w-4 text-muted-foreground transition-colors duration-300 ease-in-out hover:text-foreground" />
                </span>
              </WorkItemInfoPopup>
            )
          )}
        </div>
      )}

      {/* Project color bar */}
      {item.projectColor && (
        <div
          className="w-1.5 shrink-0 self-stretch"
          style={{ backgroundColor: item.projectColor }}
        />
      )}

      <div className={cn("relative flex-1 px-3 pb-3 space-y-2 min-w-0", (hasBottomAvatars || item.childrenCount > 0) && "pb-7")}>
        {(item.projectName || item.taskId) && (
          <div
            className="flex items-center gap-1 min-w-0 text-[10px] font-semibold uppercase tracking-wide pt-1.5"
            style={{ color: item.projectColor ?? undefined }}
          >
            {item.taskId && (
              <span
                className="font-mono cursor-pointer hover:underline hover:opacity-80 transition-opacity shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyTaskCommand?.();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title={`Copy /implement ${item.taskId}`}
              >
                {item.taskId}
              </span>
            )}
            {item.taskId && item.projectName && <span className="shrink-0">|</span>}
            {item.projectName && <span className="truncate min-w-0">{item.projectName}</span>}
            {isDodApproved && (
              <DefinitionOfDoneApprovedBadge label={t("card.definitionOfDoneApproved")} />
            )}
            {humanActionRequirement.required && (
              <HumanActionRequiredBadge
                label={t("card.humanActionRequired")}
                actionLabel={t("card.humanActionRequiredAction")}
                message={humanActionMessage}
                requirements={humanActionRequirements}
              />
            )}
            {externalValidationRequirement.required && (
              <ExternalValidationRequiredBadge
                label={t("card.externalValidationRequired")}
                message={externalValidationMessage}
                tools={externalValidationRequirement.tools}
              />
            )}
          </div>
        )}

        {/* Metadata row: status indicators + progress */}
        {(() => {
          const pr = (item.metadata as WorkItemMetadata)?.pullRequest;
          const hasPr = !!pr && pr.state !== "closed";
          const ciStatus = (item.metadata as WorkItemMetadata)?.ciStatus;
          const hasCiStatus = !!ciStatus;
          const hasBug = (item.metadata as WorkItemMetadata)?.isBug === true;
          const hasTested = (item.metadata as WorkItemMetadata)?.tested === true;
          const hasPreview = !!(item.metadata as WorkItemMetadata)?.previewUrl;
          const hasPriority = !!item.priority;
          const hasProgress = isGroupedCard && item.childrenSummary && item.childrenSummary.totalLeafCount > 0;
          const storyPoints = getPositiveStoryPoints(item);
          const tshirtSize = storyPoints !== null ? pointsToTShirtSize(storyPoints) : null;
          const hasTShirt = tshirtSize !== null;
          const hasAnyIndicator = hasBug || hasTested || hasPreview || hasPr || hasCiStatus || hasPriority || hasTShirt || showUserActions || hasAiError || (showAgentIcons && agentJobStatus && agentJobProvider) || hasProgress;

          if (!hasAnyIndicator) return null;

          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              {hasPriority && (() => {
                const PriorityIcon = priorityIcons[item.priority];
                return <PriorityIcon className={cn("h-3.5 w-3.5", priorityColors[item.priority])} />;
              })()}
              {hasTShirt && tshirtSize !== null && storyPoints !== null && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0">
                      <TShirtBadge size={tshirtSize} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t("card.storyPoints", { points: storyPoints })}</TooltipContent>
                </Tooltip>
              )}
              {hasBug && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-red-500"><Bug className="h-3.5 w-3.5" /></span>
                  </TooltipTrigger>
                  <TooltipContent>{t("card.bug")}</TooltipContent>
                </Tooltip>
              )}
              {hasTested && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-green-500"><ShieldCheck className="h-3.5 w-3.5" /></span>
                  </TooltipTrigger>
                  <TooltipContent>{t("card.tested")}</TooltipContent>
                </Tooltip>
              )}
              {hasPreview && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={(item.metadata as WorkItemMetadata).previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="text-blue-500 hover:text-blue-600 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>{t("card.previewDeployment")}</TooltipContent>
                </Tooltip>
              )}
              {(hasPr || hasCiStatus) && (
                <GitHubStatusBadge pullRequest={pr} ciStatus={ciStatus} size="md" />
              )}
              {(() => {
                const release = (item.metadata as WorkItemMetadata)?.releasePullRequest;
                if (!release || release.state === "closed") return null;
                const isMerged = release.state === "merged";
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a
                        href={release.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        className={cn(
                          "shrink-0 transition-colors",
                          isMerged
                            ? "text-purple-500 hover:text-purple-600"
                            : "text-blue-500 hover:text-blue-600",
                        )}
                        aria-label={t("card.releasePr", { number: release.releaseNumber })}
                      >
                        <Rocket className="h-3.5 w-3.5" />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("card.releasePr", { number: release.releaseNumber })}
                      {isMerged ? ` · ${t("card.releaseMerged")}` : ` · ${t("card.releaseOpen")}`}
                    </TooltipContent>
                  </Tooltip>
                );
              })()}
              {showUserActions && (
                <Tooltip delayDuration={500}>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        "relative inline-flex",
                        checklistStatus?.hasIncomplete
                          ? "text-amber-500"
                          : checklistStatus && !checklistStatus.hasIncomplete
                          ? "text-green-500"
                          : "text-blue-500"
                      )}
                    >
                      <Info className="h-3.5 w-3.5" />
                      {checklistStatus?.hasIncomplete && (
                        <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-amber-500 text-[8px] text-white font-bold leading-none px-0.5">
                          {checklistStatus.uncheckedItems.length}/{checklistStatus.totalItems}
                        </span>
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" align="start" className="w-72 max-h-[70vh] overflow-y-auto bg-popover text-popover-foreground border rounded-lg p-3 shadow-lg space-y-1.5">
                    <p className="text-[11px] font-semibold">{t(isDeployChecklist ? "card.deployChecklistTitle" : "card.userActionsTitle")}</p>
                    {userActions ? (
                      <UserActionsChecklistContainer
                        itemId={item.id}
                        metadata={item.metadata as WorkItemMetadata}
                        userActions={userActions}
                      />
                    ) : hasAggregatedUserActions ? (
                      <AggregatedUserActionsChecklistContainer entries={aggregatedUserActions!} />
                    ) : null}
                  </TooltipContent>
                </Tooltip>
              )}
              {hasAiError && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-red-500"><AlertTriangle className="h-3.5 w-3.5" /></span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs bg-[oklch(0.25_0.13_25)] border border-[oklch(0.38_0.14_25)] text-[oklch(0.88_0.18_25)]">
                    <p className="text-xs font-medium">AI Error{lastAiError!.type ? ` (${lastAiError!.type})` : ""}</p>
                    <p className="text-xs text-red-400/70">{lastAiError!.message}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {showAgentIcons && agentJobStatus && agentJobProvider && (
                <span className="ml-auto flex items-center gap-1">
                  <AgentJobIndicator status={agentJobStatus} provider={agentJobProvider} />
                </span>
              )}
              {hasProgress && item.childrenSummary && (() => {
                const pending = item.childrenSummary.totalLeafCount - item.childrenSummary.doneCount;
                if (pending <= 0) return null;
                return (
                  <span className={cn("text-xs text-muted-foreground whitespace-nowrap", !(showAgentIcons && agentJobStatus && agentJobProvider) && "ml-auto")}>
                    {t("card.pendingTasks", { count: pending })}
                  </span>
                );
              })()}
            </div>
          );
        })()}

        {/* Title */}
        <div className={cn("flex items-start justify-between gap-2", !item.projectName && !item.taskId && "mt-3")}>
          <p className="text-[15px] leading-snug font-medium break-words min-w-0 flex-1">{stripTitlePrefix(item.title)}</p>
          {isAutoPositioned && !isGroupedCard && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0">
                  <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground/60" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("card.autoPositioned")}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {isWaitingForInput && (
          <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full dark:bg-amber-950/40 dark:text-amber-400">
            {tAgents("needsInput")}
          </span>
        )}

        {/* Description preview — inline markdown with 4-line clamp */}
        {item.description && (
          <div className="line-clamp-4 text-[12px] leading-[1.35] text-foreground/80">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={createInlineMarkdownComponents()}>
              {item.description}
            </ReactMarkdown>
          </div>
        )}


        {item.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* Children expand button - absolute bottom left */}
        {item.childrenCount > 0 && (
          <button
            type="button"
            className="absolute bottom-0.5 left-3 text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {item.childrenCount} {t("card.sub")}
          </button>
        )}

        {hasBottomAvatars && (
          <div className="absolute bottom-2 right-3 flex items-center gap-1.5">
            <ParticipantAvatars
              participants={combinedParticipants}
              creator={item.createdBy}
            />
          </div>
        )}
      </div>
      </div>

      {/* Expanded children list — slides out from behind the card */}
      {item.childrenCount > 0 && (
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.33,1,0.68,1)]",
            isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          <div className="overflow-hidden">
            <div
              className={cn(
                "border-t border-border/50 shadow-[inset_0_4px_6px_-4px_rgba(0,0,0,0.3)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.33,1,0.68,1)] origin-top",
                isExpanded ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
              )}
            >
              <WorkItemChildrenList
                items={childrenItems ?? []}
                isLoading={isLoadingChildren}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const WorkItemCard = memo(WorkItemCardInner, (prev, next) => {
  return (
    prev.compact === next.compact &&
    prev.item.id === next.item.id &&
    prev.item.title === next.item.title &&
    prev.item.description === next.item.description &&
    prev.item.type === next.item.type &&
    prev.item.priority === next.item.priority &&
    prev.item.assignee === next.item.assignee &&
    prev.item.assignees === next.item.assignees &&
    prev.item.childrenCount === next.item.childrenCount &&
    prev.item.isVirtualColumn === next.item.isVirtualColumn &&
    prev.item.taskId === next.item.taskId &&
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
});

WorkItemCard.displayName = "WorkItemCard";
