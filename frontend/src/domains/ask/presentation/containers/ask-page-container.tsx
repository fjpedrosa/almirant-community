"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { projectsApi } from "@/lib/api/client";
import { projectKeys } from "@/domains/projects/application/hooks/use-projects";
import { useAskQuery } from "../../application/hooks/use-ask-query";
import { useAskFeedback } from "../../application/hooks/use-ask-feedback";
import { mapAskToConversation } from "../../application/utils/map-ask-to-conversation";
import type { AskFilters, AskFeedbackRating } from "../../domain/types";
import type { QuickFeedbackData } from "@/domains/shared/domain/conversation-types";
import { AskPageLayout } from "../components/ask-page-layout";
import { AskInput } from "../components/ask-input";
import { AskConversationTimeline } from "../components/ask-conversation-timeline";
import { AskProjectSelector } from "../components/ask-project-selector";
import { AskEmptyState } from "../components/ask-empty-state";
import { AskBetaBadge } from "../components/ask-beta-badge";

// ---------------------------------------------------------------------------
// Container: AskPageContainer
// ---------------------------------------------------------------------------
// Chat-style Ask page. Wires useAskQuery + useAskFeedback to the
// conversation timeline and chat input.
// ---------------------------------------------------------------------------

export const AskPageContainer: React.FC = () => {
  const t = useTranslations("ask");

  // ----- Project selection -----
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );

  const { data: projects = [], isLoading: isLoadingProjects } = useQuery({
    queryKey: projectKeys.lists(),
    queryFn: () =>
      projectsApi.list() as Promise<Array<{ id: string; name: string }>>,
    staleTime: 5 * 60 * 1000,
  });

  const effectiveProjectId = useMemo(() => {
    if (selectedProjectId) return selectedProjectId;
    return projects[0]?.id ?? null;
  }, [selectedProjectId, projects]);

  // ----- Filters -----
  const filters: AskFilters = useMemo(
    () => ({
      projectId: effectiveProjectId ?? "",
      featureId: undefined,
      timeRange: undefined,
    }),
    [effectiveProjectId]
  );

  // ----- Hooks -----
  const ask = useAskQuery({ filters });
  const feedback = useAskFeedback();

  // ----- Handlers -----
  const handleProjectChange = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
  }, []);

  const handleSubmit = useCallback(
    (question: string) => {
      ask.submitQuestion(question);
    },
    [ask]
  );

  const handleFeedback = useCallback(
    (messageId: string, data: QuickFeedbackData) => {
      // messageId format: "${historyItem.id}-assistant"
      // Extract sessionId from the current response matching this message
      const historyItemId = messageId.replace("-assistant", "");
      const historyItem = ask.history.find((h) => h.id === historyItemId);
      if (!historyItem?.response?.sessionId) return;

      const rating: AskFeedbackRating =
        data.sentiment === "positive" ? "helpful" : "not_helpful";

      feedback.submitFeedback({
        sessionId: historyItem.response.sessionId,
        rating,
        comment: data.content || undefined,
      });
    },
    [ask.history, feedback]
  );

  // ----- Derived state -----
  const conversationMessages = useMemo(
    () => mapAskToConversation(ask.history),
    [ask.history]
  );

  const hasMessages = ask.history.length > 0;

  // ----- No project selected state -----
  if (!effectiveProjectId && !isLoadingProjects) {
    return (
      <AskPageLayout
        header={
          <AskProjectSelector
            projects={projects}
            selectedProjectId={effectiveProjectId}
            onProjectChange={handleProjectChange}
            isLoading={isLoadingProjects}
          />
        }
        footer={
          <AskInput
            onSubmit={handleSubmit}
            isLoading={ask.isLoading}
            placeholder={t("input.placeholder")}
            disabled={true}
          />
        }
      >
        <div className="flex-1 flex items-center justify-center p-8">
          <AskEmptyState
            title={t("noProjectSelected")}
            description={t("selectProjectPrompt")}
          />
        </div>
      </AskPageLayout>
    );
  }

  return (
    <AskPageLayout
      header={
        <div className="flex items-center justify-between">
          <AskProjectSelector
            projects={projects}
            selectedProjectId={effectiveProjectId}
            onProjectChange={handleProjectChange}
            isLoading={isLoadingProjects}
          />
          <AskBetaBadge />
        </div>
      }
      footer={
        <AskInput
          onSubmit={handleSubmit}
          isLoading={ask.isLoading}
          placeholder={t("input.projectPlaceholder")}
          disabled={!effectiveProjectId}
        />
      }
    >
      {hasMessages ? (
        <AskConversationTimeline
          messages={conversationMessages}
          isLoading={ask.isLoading}
          onFeedback={handleFeedback}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <AskEmptyState
            title={t("emptyState.title")}
            description={t("emptyState.description")}
          />
        </div>
      )}
    </AskPageLayout>
  );
};
