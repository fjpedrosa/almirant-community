"use client";

import { useCallback, useMemo } from "react";
import { useProjectBoardSelector } from "./use-project-board-selector";
import { useModelSelector } from "./use-model-selector";
import { usePlanningSession } from "@/domains/planning/application/hooks/use-planning-session";
import { useWorkItemGeneration } from "./use-work-item-generation";
import { useSessionSidebar } from "./use-session-sidebar";
import { useSeedImportDialog } from "./use-seed-import-dialog";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { usePlanningSessionLifecycle } from "./use-planning-session-lifecycle";
import { usePlanningMessages } from "./use-planning-messages";
import { usePlanningLayout } from "./use-planning-layout";
import { useBoardColumns } from "./use-board-columns";
import { useSeedAnnotations } from "./use-seed-annotations";
import { useSeedEnrichment } from "./use-seed-enrichment";
import { useChatFeedback } from "./use-chat-feedback";
import { useProjectAiConfig } from "@/domains/projects/application/hooks/use-project-ai-config";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import type { AiConfigProvider } from "@/domains/projects/domain/types";
import { shouldShowPlanningSeedContext } from "./planning-seed-visibility";

/** Map project AI config provider to coding agent */
const AI_CONFIG_TO_CODING_AGENT: Record<AiConfigProvider, CodingAgent> = {
  "claude-code": "claude-code",
  codex: "codex",
  zipu: "opencode",
  grok: "opencode",
};

// ---------------------------------------------------------------------------
// Hook: usePlanChatPage
// ---------------------------------------------------------------------------
// Lightweight orchestrator that composes specialized sub-hooks.
// Returns a grouped API (max 15 top-level keys) for the container.
// ---------------------------------------------------------------------------

export const usePlanChatPage = () => {
  const { user } = useAuth();
  const projectBoard = useProjectBoardSelector();
  const aiConfig = useProjectAiConfig(projectBoard.selectedProjectId);
  const defaultCodingAgent = useMemo<CodingAgent | undefined>(
    () => aiConfig.defaultProvider ? AI_CONFIG_TO_CODING_AGENT[aiConfig.defaultProvider] : undefined,
    [aiConfig.defaultProvider],
  );
  const modelSelector = useModelSelector({ defaultCodingAgent });
  const planningSession = usePlanningSession();
  const sidebar = useSessionSidebar();
  const layout = usePlanningLayout();
  const boardColumns = useBoardColumns(projectBoard.selectedBoardId);

  const generation = useWorkItemGeneration(
    planningSession.generatedItems,
    projectBoard.selectedProjectId,
    projectBoard.selectedBoardId,
  );

  const lifecycle = usePlanningSessionLifecycle(
    planningSession,
    projectBoard,
    sidebar,
    generation,
    () => modelSelector.selectedCodingAgent
      ? { codingAgent: modelSelector.selectedCodingAgent, provider: modelSelector.selectedKey?.provider, model: modelSelector.selectedModel }
      : undefined,
  );

  const seedImport = useSeedImportDialog(lifecycle.onSeedImportComplete, {
    defaultProjectId: projectBoard.selectedProjectId,
    currentUserId: user?.id,
  });
  const seedAnnotations = useSeedAnnotations();
  const seedEnrichment = useSeedEnrichment();
  const chatFeedback = useChatFeedback({
    sessionId: planningSession.sessionId ?? undefined,
    projectId: projectBoard.selectedProjectId ?? undefined,
  });

  // ----- Seed collapse state -----
  // Controlled via seedsCollapsedOverride (user toggle) + auto-collapse from lifecycle
  const seedsCollapsed = lifecycle.seedsAutoCollapsed;

  // ----- Enrichment phase -----
  // Keep the seeds context visible until the first real user turn starts.
  // Prewarmed sessions restore as `active` after refresh even before the user sends
  // the first prompt, so `isSessionActive` alone is not enough to hide this panel.
  const hasStartedConversation =
    planningSession.messages.some((message) => message.role === "user") ||
    !!planningSession.pendingUserMessage ||
    !!planningSession.streamingContent ||
    !!planningSession.streamingThinkingContent ||
    planningSession.streamingBlocks.length > 0;
  const isEnrichingPhase = shouldShowPlanningSeedContext({
    attachedSeedCount: lifecycle.attachedSeeds.length,
    isSessionActive: lifecycle.isSessionActive,
    hasInjectedSeeds: lifecycle.hasInjectedSeeds,
    isStarting: lifecycle.isStarting,
    phase: planningSession.phase,
    hasStartedConversation,
  });

  const messages = usePlanningMessages(
    planningSession,
    lifecycle,
    projectBoard,
    modelSelector,
    seedAnnotations.getAnnotations,
  );

  // ----- Auto-open generation panel when items arrive -----
  const showGeneration = generation.activeItemCount > 0;

  // ----- Confirm generation -----
  const handleConfirmGeneration = useCallback(() => {
    if (!boardColumns.activeColumnId) return;
    generation.confirmGeneration(boardColumns.activeColumnId);
  }, [boardColumns.activeColumnId, generation]);

  // ----- Resume interrupted session -----
  const handleResume = useCallback(() => {
    if (!planningSession.sessionId) return;
    planningSession.resumeSession(planningSession.sessionId);
  }, [planningSession]);

  // ----- Enhanced sidebar with lifecycle handlers -----
  const enhancedSidebar = useMemo(
    () => ({
      ...sidebar,
      onSessionClick: lifecycle.onSidebarSessionClick,
      onSessionResume: lifecycle.onSidebarSessionResume,
      onNewSession: lifecycle.onSidebarNewSession,
    }),
    [sidebar, lifecycle.onSidebarSessionClick, lifecycle.onSidebarSessionResume, lifecycle.onSidebarNewSession],
  );

  return {
    // 1. Sidebar
    sidebar: enhancedSidebar,

    // 2. Layout
    layout: {
      isMobileSidebarOpen: layout.isMobileSidebarOpen,
      setMobileSidebarOpen: layout.setMobileSidebarOpen,
      onToggleMobileSidebar: layout.onToggleMobileSidebar,
    },

    // 3. Session (lifecycle state + handlers)
    session: {
      isSessionActive: lifecycle.isSessionActive,
      isStarting: lifecycle.isStarting,
      showChatPanel: lifecycle.showChatPanel,
      sessionId: lifecycle.sessionId,
      isLoadingFromUrl: lifecycle.isLoadingFromUrl,
      onStartSession: lifecycle.onStartSession,
      onNewSession: lifecycle.onNewSession,
      onCancelGeneration: lifecycle.onCancelGeneration,
      isCompleted: (() => {
        // Don't show completed state while streaming is still active
        if (planningSession.phase === "streaming" || planningSession.phase === "thinking" || planningSession.phase === "booting") return false;
        if (planningSession.streamingContent) return false;
        const s = planningSession.session;
        if (!s) return false;
        if (s.status !== "completed" && s.status !== "archived") return false;
        // Only show summary styling for sessions that completed successfully.
        // Sessions killed, cancelled, or timed out have reason/summary indicating failure.
        const result = s.result as Record<string, unknown> | null;
        if (!result) return false;
        const reason = result.reason as string | undefined;
        const summary = (result.summary as string | undefined) ?? "";
        if (reason === "idle_timeout" || reason === "killed_by_user") return false;
        if (/failed|cancelled|canceled|killed|error|aborted/i.test(summary)) return false;
        // Require work items to have been created
        return (s.workItemCount ?? 0) > 0;
      })(),
      conflictDialog: lifecycle.conflictDialog,
      // Interrupted/Resuming state
      isInterrupted: planningSession.phase === "interrupted",
      isResuming: planningSession.phase === "resuming",
      interruptionReason: planningSession.interruptionReason,
      resumeStep: planningSession.resumeStep,
      onResume: handleResume,
      // Session ended without success (idle timeout, killed, etc)
      isSessionEnded: (() => {
        // Don't show ended state while streaming is still active
        if (planningSession.phase === "streaming" || planningSession.phase === "thinking" || planningSession.phase === "booting") return false;
        if (planningSession.streamingContent) return false;
        const s = planningSession.session;
        if (!s) return false;
        if (s.status !== "completed" && s.status !== "archived") return false;
        if (planningSession.phase === "interrupted") return false;
        // Check if it ended without success (no work items created, or reason is timeout/killed)
        const result = s.result as Record<string, unknown> | null;
        const reason = (result?.reason as string) ?? "";
        const hasWorkItems = (s.workItemCount ?? 0) > 0;
        return !hasWorkItems || /idle_timeout|killed/i.test(reason);
      })(),
      endReason: (() => {
        const s = planningSession.session;
        if (!s) return null;
        const result = s.result as Record<string, unknown> | null;
        return (result?.reason as string) ?? null;
      })(),
      onRestartSession: lifecycle.onRestartEndedSession,
      // Follow-up state: agent needs a response to continue
      pendingFollowUp: planningSession.pendingFollowUp,
      followUpPrompt: planningSession.followUpPrompt,
      expiresAt: planningSession.expiresAt,
      // Completed session work items summary
      completedWorkItems: planningSession.generatedItems.map((item) => ({
        tempId: item.tempId,
        type: item.type,
        title: item.title,
      })),
      completedWorkItemCount:
        planningSession.session?.workItemCount ?? planningSession.generatedItems.length,
    },

    // 4. Messages (chat data + send)
    messages: {
      items: messages.messages,
      streamingContent: messages.streamingContent,
      streamingThinkingContent: planningSession.streamingThinkingContent,
      streamingBlocks: messages.streamingBlocks,
      completedTurnBlocks: messages.completedTurnBlocks,
      isStreaming: messages.isStreaming,
      latestActivity: messages.latestActivity,
      processingStartedAt: planningSession.processingStartedAt,
      pendingUserMessage: messages.pendingUserMessage,
      sendMessage: messages.sendMessage,
      providerLabel: messages.providerLabel,
      selectedModel: messages.selectedModel,
      showModelBadge: messages.showModelBadge,
      activeProjectName: messages.activeProjectName,
      activeModelLabel: messages.activeModelLabel,
      modelSelectorProps: messages.modelSelectorProps,
      totalTokens: planningSession.tokenUsage.input + planningSession.tokenUsage.output,
      onStop: planningSession.cancelSession,
      onKill: planningSession.killSession,
      onPause: planningSession.interruptSession,
      isPaused: planningSession.phase === "paused",
      selectedCodingAgent: messages.selectedCodingAgent,
      handleCodingAgentChange: messages.handleCodingAgentChange,
      onFeedback: chatFeedback.handleFeedback,
    },

    // 5. Generation
    generation: {
      show: showGeneration,
      previewItems: generation.previewItems,
      columns: boardColumns.columns,
      activeColumnId: boardColumns.activeColumnId,
      activeItemCount: generation.activeItemCount,
      isConfirming: generation.isConfirming,
      isAlreadyCreated: generation.isAlreadyCreated,
      updateItem: generation.updateItem,
      removeItem: generation.removeItem,
      onColumnChange: boardColumns.onColumnChange,
      onConfirm: handleConfirmGeneration,
    },

    // 6. Seeds
    seeds: {
      seedImport,
      attachedSeeds: lifecycle.attachedSeeds,
      onRemoveSeed: lifecycle.onRemoveSeed,
      seedCount: lifecycle.attachedSeeds.length,
      annotations: seedAnnotations.annotations,
      onAnnotationChange: seedAnnotations.handleAnnotationChange,
      isCollapsed: seedsCollapsed,
      onToggleCollapse: lifecycle.toggleSeedsCollapsed,
      submittedSeedIds: lifecycle.submittedSeedIds,
      hasInjectedSeeds: lifecycle.hasInjectedSeeds,
      isEnrichingPhase,
      enrichment: seedEnrichment,
    },

    // 7. Header (project selector)
    header: {
      projects: projectBoard.projects,
      selectedProjectId: projectBoard.selectedProjectId,
      isLoadingProjects: projectBoard.isLoadingProjects,
      onProjectChange: projectBoard.onProjectChange,
    },

    // 8. Question (interactive Q&A)
    question: {
      pendingQuestion: planningSession.pendingQuestion,
      sendAnswer: planningSession.sendAnswer,
    },
  };
};
