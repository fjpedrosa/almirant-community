"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ChevronDown, Compass, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Paperclip, GitCommit, FileText, Lightbulb, Link2, Bot, ScrollText, Cpu, Video, ClipboardCheck } from "lucide-react";
import { DodHumanActionPanelContainer } from "./dod-human-action-panel-container";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import type { PullRequestRef, WalkthroughRecording, WorkItem, WorkItemMetadata, WorkItemType } from "../../domain/types";
import { useUpdateWorkItem } from "../../application/hooks/use-work-items";
import { usePlanningOrigin } from "../../application/hooks/use-planning-origin";
import { UserActionsChecklist } from "../components/user-actions-checklist";
import { PlanningOriginSection } from "../components/planning-origin-section";
import { AggregatedUserActionsChecklist } from "../components/aggregated-user-actions-checklist";
import { AggregatedWalkthroughSection } from "../components/aggregated-walkthrough-section";
import { WalkthroughSectionContainer } from "./walkthrough-section-container";
import { useWorkItemContext } from "../../application/hooks/use-work-item-context";
import { useAttachments, useUploadAttachment, useDeleteAttachment } from "../../application/hooks/use-attachments";
import { useAddDependency, useRemoveDependency } from "../../application/hooks/use-dependencies";
import { useLinkCommit, useUnlinkCommit } from "../../application/hooks/use-link-commit";
import { useLinkDocument, useUnlinkDocument, useAvailableDocuments } from "../../application/hooks/use-work-item-documents";

import { useGithubCommits } from "@/domains/github/application/hooks/use-github-commits";
import { useWorkItems } from "../../application/hooks/use-work-items";
import { AttachmentSection } from "../components/attachment-section";
import { DependencySection } from "../components/dependency-section";
import { LinkedCommitsSection } from "../components/linked-commits-section";
import { LinkedDocumentsSection } from "../components/linked-documents-section";
import { SuggestedDocsSection } from "../components/suggested-docs-section";
import { AiCostBadge } from "../components/ai-cost-badge";
import { AgentThreadContainer } from "@/domains/agents/presentation/containers/agent-thread-container";
import { WorkItemAiRunLogsContainer } from "@/domains/agents/presentation/containers/work-item-ai-run-logs-container";

// --- Collapsible section wrapper ---

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  icon,
  title,
  count,
  defaultOpen = false,
  children: sectionChildren,
}) => (
  <Collapsible defaultOpen={defaultOpen}>
    <CollapsibleTrigger className="flex items-center gap-2 w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1 group cursor-pointer">
      {icon}
      <span>{title}</span>
      {count != null && count > 0 && (
        <span className="text-xs font-normal ml-1">({count})</span>
      )}
      <ChevronDown className="h-3.5 w-3.5 ml-auto transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
    <CollapsibleContent className="pt-2">{sectionChildren}</CollapsibleContent>
  </Collapsible>
);

// --- Loading fallback ---

const SectionFallback = () => (
  <div className="space-y-2 py-2">
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4" />
  </div>
);

// --- Main container ---

interface PanelAdvancedSectionsProps {
  workItemId: string;
  projectId: string | null;
  pullRequest?: PullRequestRef | null;
  workItem?: WorkItem;
  workItemType?: WorkItemType;
}

const PR_STATE_STYLES: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  draft: { icon: GitPullRequestDraft, color: "text-muted-foreground", label: "Draft" },
  open: { icon: GitPullRequest, color: "text-green-500", label: "Open" },
  merged: { icon: GitMerge, color: "text-purple-500", label: "Merged" },
  closed: { icon: GitPullRequestClosed, color: "text-red-500", label: "Closed" },
};

export const PanelAdvancedSections: React.FC<PanelAdvancedSectionsProps> = ({
  workItemId,
  projectId,
  pullRequest,
  workItem,
  workItemType,
}) => {
  const t = useTranslations("workItems.detail");

  // Batch context data
  const {
    dependenciesData,
    linkedDocumentsData,
    suggestedDocsData,
    aiSessionsData,
    childrenData,
    commitsData,
    isLoadingDependencies,
    isLoadingLinkedDocs,
    isLoadingSuggestedDocs,
    isLoadingCommits,
  } = useWorkItemContext(workItemId);

  // Update mutation for implementation outcomes toggle
  const { mutate: updateWorkItem } = useUpdateWorkItem();

  // Attachments (separate query)
  const { data: attachments, isLoading: isLoadingAttachments } = useAttachments(workItemId);
  const uploadAttachment = useUploadAttachment(workItemId);
  const deleteAttachment = useDeleteAttachment(workItemId);

  // Dependencies mutations
  const addDependency = useAddDependency(workItemId);
  const removeDependency = useRemoveDependency(workItemId);

  // Commits mutations
  const linkCommit = useLinkCommit(workItemId);
  const unlinkCommit = useUnlinkCommit(workItemId);

  // Documents mutations
  const linkDocument = useLinkDocument(workItemId);
  const unlinkDocument = useUnlinkDocument(workItemId);
  const { data: availableDocsData } = useAvailableDocuments(true);

  // Available work items for dependency picker (lightweight: just list all from same board)
  const { data: allWorkItems } = useWorkItems();
  const availableDependencyItems = useMemo(
    () =>
      (allWorkItems ?? []).map((item) => ({
        id: item.id,
        taskId: item.taskId,
        title: item.title,
        type: item.type,
      })),
    [allWorkItems]
  );

  // Available commits for linking
  const githubCommitsQuery = useGithubCommits(projectId ?? "", 200);
  const availableCommits = useMemo(
    () =>
      (githubCommitsQuery.data ?? []).map((c) => ({
        id: c.id,
        sha: c.sha,
        message: c.message,
        authorLogin: c.authorLogin,
        branch: c.branch,
        committedAt: c.committedAt,
      })),
    [githubCommitsQuery.data]
  );

  // Available documents for linking
  const availableDocuments = useMemo(
    () =>
      (availableDocsData ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        projectName: d.projectName ?? null,
      })),
    [availableDocsData]
  );

  // --- Implementation Outcomes (Next Steps) ---
  const currentMeta = workItem?.metadata as WorkItemMetadata | undefined;
  const isParentType = workItemType === "feature" || workItemType === "epic" || workItemType === "story";

  // Planning origin (for work items created via AI planning sessions)
  const planningOrigin = usePlanningOrigin(currentMeta);

  // Leaf item: own metadata fields
  const deployChecklist = currentMeta?.deployChecklist ?? currentMeta?.userActions ?? "";
  const validationChecks = currentMeta?.validationChecks ?? "";
  const documentationNotes = currentMeta?.documentationNotes ?? "";
  const hasOwnOutcomes = !isParentType && (deployChecklist.trim().length > 0 || validationChecks.trim().length > 0 || documentationNotes.trim().length > 0);

  const handleDeployToggle = useCallback(
    (updatedMarkdown: string) => {
      if (!workItem) return;
      const field = currentMeta?.deployChecklist ? "deployChecklist" : "userActions";
      updateWorkItem({ id: workItem.id, data: { metadata: { ...currentMeta, [field]: updatedMarkdown } } });
    },
    [workItem, currentMeta, updateWorkItem]
  );
  const handleValidationToggle = useCallback(
    (updatedMarkdown: string) => {
      if (!workItem) return;
      updateWorkItem({ id: workItem.id, data: { metadata: { ...currentMeta, validationChecks: updatedMarkdown } } });
    },
    [workItem, currentMeta, updateWorkItem]
  );
  const handleDocumentationToggle = useCallback(
    (updatedMarkdown: string) => {
      if (!workItem) return;
      updateWorkItem({ id: workItem.id, data: { metadata: { ...currentMeta, documentationNotes: updatedMarkdown } } });
    },
    [workItem, currentMeta, updateWorkItem]
  );

  // Parent item: aggregated entries from children
  const aggregatedDeployEntries = useMemo(() => {
    if (!isParentType || !childrenData) return [];
    return childrenData
      .filter((c) => {
        const m = c.metadata as WorkItemMetadata | undefined;
        return (m?.deployChecklist ?? m?.userActions ?? "").trim().length > 0;
      })
      .map((c) => {
        const m = c.metadata as WorkItemMetadata;
        return { itemId: c.id, taskId: c.taskId, userActions: (m.deployChecklist ?? m.userActions ?? "").trim() };
      });
  }, [isParentType, childrenData]);

  const aggregatedValidationEntries = useMemo(() => {
    if (!isParentType || !childrenData) return [];
    return childrenData
      .filter((c) => {
        const m = c.metadata as WorkItemMetadata | undefined;
        return (m?.validationChecks ?? "").trim().length > 0;
      })
      .map((c) => {
        const m = c.metadata as WorkItemMetadata;
        return { itemId: c.id, taskId: c.taskId, userActions: m.validationChecks!.trim() };
      });
  }, [isParentType, childrenData]);

  const aggregatedDocumentationEntries = useMemo(() => {
    if (!isParentType || !childrenData) return [];
    return childrenData
      .filter((c) => {
        const m = c.metadata as WorkItemMetadata | undefined;
        return (m?.documentationNotes ?? "").trim().length > 0;
      })
      .map((c) => {
        const m = c.metadata as WorkItemMetadata;
        return { itemId: c.id, taskId: c.taskId, userActions: m.documentationNotes!.trim() };
      });
  }, [isParentType, childrenData]);

  const hasAggregatedOutcomes = aggregatedDeployEntries.length > 0 || aggregatedValidationEntries.length > 0 || aggregatedDocumentationEntries.length > 0;

  // Aggregated walkthrough recordings from children (for parent types)
  const aggregatedWalkthroughEntries = useMemo(() => {
    if (!isParentType || !childrenData) return [];
    return childrenData
      .filter((c) => {
        const m = c.metadata as WorkItemMetadata | undefined;
        return (m?.walkthrough?.recordings ?? []).length > 0;
      })
      .map((c) => {
        const m = c.metadata as WorkItemMetadata;
        return {
          taskId: c.taskId,
          title: c.title,
          recordings: m.walkthrough!.recordings,
        };
      });
  }, [isParentType, childrenData]);

  const [selectedAggregatedRecording, setSelectedAggregatedRecording] = useState<WalkthroughRecording | null>(null);

  const handleAggregatedDeployToggle = useCallback(
    (itemId: string, updatedMarkdown: string) => {
      const child = childrenData?.find((c) => c.id === itemId);
      const m = child?.metadata as WorkItemMetadata | undefined;
      const field = m?.deployChecklist ? "deployChecklist" : "userActions";
      updateWorkItem({ id: itemId, data: { metadata: { [field]: updatedMarkdown } } });
    },
    [childrenData, updateWorkItem]
  );
  const handleAggregatedValidationToggle = useCallback(
    (itemId: string, updatedMarkdown: string) => {
      updateWorkItem({ id: itemId, data: { metadata: { validationChecks: updatedMarkdown } } });
    },
    [updateWorkItem]
  );
  const handleAggregatedDocumentationToggle = useCallback(
    (itemId: string, updatedMarkdown: string) => {
      updateWorkItem({ id: itemId, data: { metadata: { documentationNotes: updatedMarkdown } } });
    },
    [updateWorkItem]
  );

  /*
   * Section visibility by work item type:
   * ┌─────────────────────┬──────┬───────┬──────┬──────┬──────┐
   * │ Section             │ Task │ Story │ Feat │ Epic │ Idea │
   * ├─────────────────────┼──────┼───────┼──────┼──────┼──────┤
   * │ Planning Origin     │  ✓*  │   ✓*  │  ✓*  │  ✓*  │  ✓*  │
   * │ Walkthrough         │  ✓   │       │      │      │      │
   * │ Walkthroughs (agg.) │      │  ✓*   │  ✓*  │  ✓*  │      │
   * │ Attachments         │  ✓   │   ✓   │  ✓   │  ✓   │  ✓   │
   * │ Dependencies        │  ✓   │   ✓   │  ✓   │  ✓   │  ✓   │
   * │ Linked Commits      │  ✓   │   ✓   │  ✓   │  ✓   │  ✓   │
   * │ Pull Request        │  ✓*  │   ✓*  │  ✓*  │  ✓*  │  ✓*  │
   * │ Linked Documents    │  ✓   │   ✓   │  ✓   │  ✓   │  ✓   │
   * │ Suggested Docs      │  ✓*  │   ✓*  │  ✓*  │  ✓*  │  ✓*  │
   * │ AI Cost             │  ✓*  │   ✓*  │  ✓*  │  ✓*  │  ✓*  │
   * │ Agent Thread        │  ✓   │   ✓   │  ✓   │  ✓   │  ✓   │
   * │ AI Run Logs         │  ✓   │   ✓   │  ✓   │  ✓   │  ✓   │
   * └─────────────────────┴──────┴───────┴──────┴──────┴──────┘
   * ✓* = conditional on data availability (only shown when data exists)
   * Note: Execution Origin moved to History tab. Sessions tab planned.
   */
  // DodHumanActionV2 panel: shown at the top when Release Integration
  // escalated a schema_irreconcilable to operator decision. Pre-empts every
  // other section because the work item is gated on the operator's choice.
  const dodHumanActionV2 = currentMeta?.dod_human_action_v2;

  return (
    <div className="space-y-4">
      {dodHumanActionV2 && workItem && (
        <CollapsibleSection
          icon={<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
          title="Human decision required"
          defaultOpen
        >
          <DodHumanActionPanelContainer
            workItemId={workItem.id}
            payload={dodHumanActionV2}
          />
        </CollapsibleSection>
      )}

      {/* Planning Origin (shown only when work item has planningSessionId) */}
      {planningOrigin.hasPlanningOrigin && (
        <CollapsibleSection
          icon={<Compass className="h-4 w-4" />}
          title={t("planningOrigin")}
          defaultOpen
        >
          <PlanningOriginSection {...planningOrigin} />
        </CollapsibleSection>
      )}

      {/* Walkthrough (tasks only) */}
      {workItem && (workItemType ?? workItem.type) === "task" && (
        <CollapsibleSection
          icon={<Video className="h-4 w-4" />}
          title={t("walkthrough")}
          defaultOpen={false}
        >
          <Suspense fallback={<SectionFallback />}>
            <WalkthroughSectionContainer workItem={workItem} />
          </Suspense>
        </CollapsibleSection>
      )}

      {/* Walkthroughs (parents — aggregated from children) */}
      {isParentType && aggregatedWalkthroughEntries.length > 0 && (
        <CollapsibleSection
          icon={<Video className="h-4 w-4" />}
          title={t("walkthroughs")}
          count={aggregatedWalkthroughEntries.reduce((sum, e) => sum + e.recordings.length, 0)}
          defaultOpen={false}
        >
          <AggregatedWalkthroughSection
            entries={aggregatedWalkthroughEntries}
            selectedRecording={selectedAggregatedRecording}
            onSelectRecording={setSelectedAggregatedRecording}
          />
        </CollapsibleSection>
      )}

      {/* Next Steps — leaf task: own outcomes */}
      {hasOwnOutcomes && (
        <CollapsibleSection
          icon={<ClipboardCheck className="h-4 w-4" />}
          title={t("nextSteps")}
          defaultOpen
        >
          <div className="space-y-3">
            {deployChecklist.trim().length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{t("deployChecklist")}</p>
                <UserActionsChecklist markdown={deployChecklist} onToggle={handleDeployToggle} />
              </div>
            )}
            {validationChecks.trim().length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{t("validationChecks")}</p>
                <UserActionsChecklist markdown={validationChecks} onToggle={handleValidationToggle} />
              </div>
            )}
            {documentationNotes.trim().length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{t("documentationNotes")}</p>
                <UserActionsChecklist markdown={documentationNotes} onToggle={handleDocumentationToggle} />
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Next Steps — parent items: aggregated from children */}
      {isParentType && hasAggregatedOutcomes && (
        <CollapsibleSection
          icon={<ClipboardCheck className="h-4 w-4" />}
          title={t("nextSteps")}
          defaultOpen
        >
          <div className="space-y-3">
            {aggregatedDeployEntries.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{t("deployChecklist")}</p>
                <AggregatedUserActionsChecklist entries={aggregatedDeployEntries} onToggle={handleAggregatedDeployToggle} />
              </div>
            )}
            {aggregatedValidationEntries.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{t("validationChecks")}</p>
                <AggregatedUserActionsChecklist entries={aggregatedValidationEntries} onToggle={handleAggregatedValidationToggle} />
              </div>
            )}
            {aggregatedDocumentationEntries.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{t("documentationNotes")}</p>
                <AggregatedUserActionsChecklist entries={aggregatedDocumentationEntries} onToggle={handleAggregatedDocumentationToggle} />
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Attachments */}
      <CollapsibleSection
        icon={<Paperclip className="h-4 w-4" />}
        title={t("attachments")}
        count={attachments?.length}
        defaultOpen
      >
        <AttachmentSection
          workItemId={workItemId}
          attachments={attachments ?? []}
          isLoading={isLoadingAttachments}
          onUpload={(file) => uploadAttachment.mutate(file)}
          onDelete={(attachmentId) => deleteAttachment.mutate(attachmentId)}
          isUploading={uploadAttachment.isPending}
        />
      </CollapsibleSection>

      {/* Dependencies */}
      <CollapsibleSection
        icon={<Link2 className="h-4 w-4" />}
        title={t("dependencies")}
        count={(dependenciesData?.dependencies?.length ?? 0) + (dependenciesData?.dependents?.length ?? 0)}
        defaultOpen
      >
        <DependencySection
          workItemId={workItemId}
          dependencies={dependenciesData?.dependencies ?? []}
          dependents={dependenciesData?.dependents ?? []}
          isLoading={isLoadingDependencies}
          availableWorkItems={availableDependencyItems}
          onAddDependency={(blockedByWorkItemId) => addDependency.mutate(blockedByWorkItemId)}
          onRemoveDependency={(blockedByWorkItemId) => removeDependency.mutate(blockedByWorkItemId)}
          isAdding={addDependency.isPending}
        />
      </CollapsibleSection>

      {/* Linked Commits */}
      <CollapsibleSection
        icon={<GitCommit className="h-4 w-4" />}
        title={t("linkedCommits")}
        count={commitsData?.length}
        defaultOpen={false}
      >
        <LinkedCommitsSection
          commits={commitsData ?? []}
          isLoading={isLoadingCommits}
          onLinkCommit={(commitId) => linkCommit.mutate(commitId)}
          onUnlinkCommit={(commitId) => unlinkCommit.mutate(commitId)}
          isLinking={linkCommit.isPending}
          availableCommits={availableCommits}
          isSearchingCommits={githubCommitsQuery.isLoading || githubCommitsQuery.isFetching}
        />
      </CollapsibleSection>

      {/* Pull Request */}
      {pullRequest && (() => {
        const displayState = pullRequest.isDraft && pullRequest.state === "open" ? "draft" : pullRequest.state;
        const style = PR_STATE_STYLES[displayState] ?? PR_STATE_STYLES.open;
        const PrIcon = style.icon;
        return (
          <CollapsibleSection
            icon={<GitPullRequest className="h-4 w-4" />}
            title={t("pullRequest")}
            defaultOpen
          >
            <div className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2">
                <PrIcon className={`h-4 w-4 ${style.color}`} />
                <a
                  href={pullRequest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium hover:underline"
                >
                  #{pullRequest.number}
                </a>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                  displayState === "merged" ? "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400"
                    : displayState === "draft" ? "bg-muted text-muted-foreground"
                    : displayState === "open" ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                    : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                }`}>
                  {style.label}
                </span>
              </div>
              {pullRequest.branch && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{pullRequest.branch}</code>
                </div>
              )}
            </div>
          </CollapsibleSection>
        );
      })()}

      {/* Linked Documents */}
      <CollapsibleSection
        icon={<FileText className="h-4 w-4" />}
        title={t("linkedDocuments")}
        count={linkedDocumentsData?.length}
        defaultOpen={false}
      >
        <LinkedDocumentsSection
          workItemId={workItemId}
          documents={linkedDocumentsData ?? []}
          isLoading={isLoadingLinkedDocs}
          availableDocuments={availableDocuments}
          onLinkDocument={(documentId) => linkDocument.mutate(documentId)}
          onUnlinkDocument={(documentId) => unlinkDocument.mutate(documentId)}
          isLinking={linkDocument.isPending}
        />
      </CollapsibleSection>

      {/* Suggested Docs */}
      {(suggestedDocsData ?? []).length > 0 && (
        <CollapsibleSection
          icon={<Lightbulb className="h-4 w-4" />}
          title={t("suggestedDocuments")}
          count={suggestedDocsData?.length}
          defaultOpen={false}
        >
          <SuggestedDocsSection
            suggestions={suggestedDocsData ?? []}
            isLoading={isLoadingSuggestedDocs}
            onLinkDocument={(documentId) => linkDocument.mutate(documentId)}
            isLinking={linkDocument.isPending}
          />
        </CollapsibleSection>
      )}

      {/* AI Cost Badge */}
      {aiSessionsData?.summary && aiSessionsData.summary.sessionCount > 0 && (
        <CollapsibleSection
          icon={<Cpu className="h-4 w-4" />}
          title={t("aiCost")}
          defaultOpen={false}
        >
          <AiCostBadge
            summary={aiSessionsData.summary}
            sessions={aiSessionsData.sessions}
          />
        </CollapsibleSection>
      )}

      {/* Agent Thread */}
      <CollapsibleSection
        icon={<Bot className="h-4 w-4" />}
        title={t("agentThread")}
        defaultOpen={false}
      >
        <Suspense fallback={<SectionFallback />}>
          <AgentThreadContainer workItemId={workItemId} />
        </Suspense>
      </CollapsibleSection>

      {/* AI Run Logs */}
      <CollapsibleSection
        icon={<ScrollText className="h-4 w-4" />}
        title={t("aiRunLogs")}
        defaultOpen={false}
      >
        <Suspense fallback={<SectionFallback />}>
          <WorkItemAiRunLogsContainer workItemId={workItemId} />
        </Suspense>
      </CollapsibleSection>
    </div>
  );
};
