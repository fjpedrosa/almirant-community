"use client";

import { useMemo } from "react";
import { TerminalSquare } from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useLiveTimer } from "@/domains/agents/application/hooks/use-live-timer";
import { ListPageShell } from "@/domains/shared/presentation/components/list-page-shell";
import { useSessionsFilters, useSessionsList } from "../../application/hooks/use-sessions-list";
import { useSessionDetailModal } from "../../application/hooks/use-session-detail-modal";
import { SessionsFilters } from "../components/sessions-filters";
import { SessionsTable } from "../components/sessions-table";
import { SessionDetailSheet } from "../components/session-detail-sheet";
import { SessionDetailView } from "../components/session-detail-view";
import type { FilterOption } from "@/domains/shared/domain/filter-types";
import { resolveSessionHeadline } from "../../domain/utils";

const ACTIVE_STATUSES = new Set(["queued", "running", "finalizing", "waiting_for_input", "paused"]);

export const SessionsPageContainer: React.FC = () => {
  const t = useTranslations("sessions");

  const { data: projects = [] } = useProjects();

  const projectOptions: FilterOption[] = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name, color: p.color })),
    [projects],
  );
  const projectColors = useMemo(
    () =>
      Object.fromEntries(projects.map((project) => [project.id, project.color])),
    [projects],
  );

  const filtersState = useSessionsFilters(projectOptions);
  const params = filtersState.buildSearchParams();

  const { sessions, meta, isLoading } = useSessionsList(params);

  const hasActiveSession = sessions.some((session) =>
    ACTIVE_STATUSES.has(session.status)
  );
  const currentTime = useLiveTimer(hasActiveSession);

  const modal = useSessionDetailModal();

  const page = meta?.page ?? filtersState.page;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <>
      <ListPageShell
        header={
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <TerminalSquare className="h-6 w-6 text-primary" />
              {t("title")}
            </h1>
            <p className="text-muted-foreground">{t("description")}</p>
          </div>
        }
        filters={
          <SessionsFilters
            config={filtersState.config}
            appliedFilters={filtersState.dynamicFilters.appliedFilters}
            availableFilters={filtersState.dynamicFilters.availableFilters}
            onAddFilter={filtersState.dynamicFilters.addFilter}
            onRemoveFilter={filtersState.dynamicFilters.removeFilter}
            onUpdateFilter={filtersState.dynamicFilters.updateFilter}
            onClearFilters={filtersState.dynamicFilters.clearFilters}
          />
        }
        footer={
          totalPages > 1 ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {t("pagination.page", { page, totalPages })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => filtersState.setPage(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => filtersState.setPage(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        <SessionsTable
          sessions={sessions}
          isLoading={isLoading}
          currentTime={currentTime}
          projectColors={projectColors}
          onOpenSession={modal.open}
        />
      </ListPageShell>

      <SessionDetailSheet
        isOpen={modal.isOpen}
        onOpenChange={modal.onOpenChange}
        title={modal.detail
          ? resolveSessionHeadline(modal.detail.job, {
              planningSessionTitle: modal.detail.planningSession?.title ?? null,
            })
          : ""}
        status={modal.detail?.job.status ?? null}
        isLive={modal.isLive}
      >
        {modal.detail && (
          <SessionDetailView
            detail={modal.detail}
            chunks={modal.output.chunks}
            duration={modal.duration}
            isLive={modal.isLive}
            isLoading={modal.isLoading}
            currentTime={modal.currentTime}
            messages={modal.messages}
            transcript={modal.transcript}
            segments={modal.segments}
            streamingBlocks={modal.streamingBlocks}
            hasBackgroundAgentsWaiting={modal.hasBackgroundAgentsWaiting}
            isStreaming={modal.isStreaming}
            isTranscriptLoading={modal.isTranscriptLoading}
            phases={modal.phases}
            resourceTimeline={modal.resourceTimeline}
            isResourceTimelineLoading={modal.isResourceTimelineLoading}
            isActive={modal.isActive}
            isCancelling={modal.isCancelling}
            elapsedTime={modal.elapsedTime}
            onStop={modal.onStop}
            pendingInteraction={modal.pendingInteraction}
            answerText={modal.answerText}
            onAnswerChange={modal.onAnswerChange}
            onRespond={modal.onRespond}
            onRespondWithOption={modal.onRespondWithOption}
            isResponding={modal.isResponding}
            taskIdMap={modal.taskIdMap}
            allThinkingCollapsed={modal.allThinkingCollapsed}
            hasThinkingBlocks={modal.hasThinkingBlocks}
            onToggleAllThinking={modal.onToggleAllThinking}
            isThinkingOpen={modal.isThinkingOpen}
            onThinkingToggle={modal.onThinkingToggle}
            onFeedback={modal.onFeedback}
          />
        )}
      </SessionDetailSheet>
    </>
  );
};
