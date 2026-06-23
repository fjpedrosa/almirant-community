/** @deprecated Use use-plan-chat-page.ts instead */
"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { boardsApi } from "@/lib/api/client";
import { authClient } from "@/lib/auth-client";
import { boardKeys } from "@/domains/boards/application/hooks/use-boards";
import { useTeamMembersSelect } from "@/domains/teams/application/hooks/use-team-members-select";
import type { BoardWithStats } from "@/domains/boards/domain/types";
import type { SeedWithRelations } from "@/domains/planning/domain/types";
import type { ChatMessage } from "@/domains/ai-planning/domain/types";
import { useProjectBoardSelector } from "./use-project-board-selector";
import { useSeedsPanelState } from "./use-seeds-panel-state";
import { useModelSelector } from "./use-model-selector";
import { usePlanningSession } from "@/domains/planning/application/hooks/use-planning-session";
import { useWorkItemGeneration } from "./use-work-item-generation";
import { buildSeedContextPrefix } from "../utils/build-seed-context";

// ---------------------------------------------------------------------------
// Hook: usePlanningPageLayout
// ---------------------------------------------------------------------------
// Orchestrator hook that composes all sub-hooks for the redesigned planning
// page. Seeds are the primary view (2/3 width) with chat as a collapsible
// side panel (1/3 width).
//
// Responsibilities:
// - Compose project/board selector, seeds panel, model selector, session, generation
// - Manage layout state: isChatOpen, mobileTab
// - Inject seed context into the first chat message per session
// - Auto-open chat when AI generates work items
// - First message creates + starts a WebSocket planning session (planning:start)
// - Subsequent messages send prompts over the existing session (planning:prompt)
// ---------------------------------------------------------------------------

export const usePlanningPageLayout = () => {
  // ----- Sub-hooks -----
  const projectBoard = useProjectBoardSelector();
  const seedsPanel = useSeedsPanelState();
  const modelSelector = useModelSelector();
  const session = usePlanningSession();

  // Ref to track current sessionId without stale closures in async callbacks
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = session.sessionId;
  }, [session.sessionId]);

  const generation = useWorkItemGeneration(
    session.generatedItems,
    projectBoard.selectedProjectId,
    projectBoard.selectedBoardId,
  );

  // ----- Board columns (for generation column selector) -----
  const boardQuery = useQuery({
    queryKey: boardKeys.detail(projectBoard.selectedBoardId),
    queryFn: () =>
      boardsApi.get(projectBoard.selectedBoardId) as Promise<BoardWithStats>,
    enabled: !!projectBoard.selectedBoardId,
  });

  const columns = useMemo(
    () => boardQuery.data?.columns ?? [],
    [boardQuery.data?.columns],
  );

  const defaultColumnId = useMemo(() => {
    const nonDone = columns.find((c) => !c.isDone);
    return nonDone?.id ?? columns[0]?.id ?? "";
  }, [columns]);

  const [selectedColumnId, setSelectedColumnId] = useState<string>("");
  const activeColumnId = selectedColumnId || defaultColumnId;

  // ----- Map PlanningMessage[] → ChatMessage[] for presentation -----
  const messages: ChatMessage[] = useMemo(
    () =>
      session.messages.map((m) => ({
        id: m.id,
        role: m.role as ChatMessage["role"],
        content: m.content,
        timestamp: m.createdAt,
      })),
    [session.messages],
  );

  // ----- Layout state -----
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"seeds" | "chat" | "detail">("seeds");
  const [selectedSeedId, setSelectedSeedId] = useState<string | null>(null);
  const [sidePanelTab, setSidePanelTab] = useState<"chat" | "detail">("chat");

  // ----- Current user and members -----
  const authSession = authClient.useSession();
  const currentUserId = authSession.data?.user?.id ?? null;
  const { members } = useTeamMembersSelect();

  // ----- Seed context injection -----
  // Track whether we've already injected seed context for the current session.
  // Resets when starting a new session.
  const hasInjectedSeedsRef = useRef(false);

  const handleToggleChat = useCallback(() => {
    setIsChatOpen((prev) => !prev);
  }, []);

  // Handle seed click from eye icon - opens detail panel
  const handleSeedClick = useCallback((seed: SeedWithRelations) => {
    setSelectedSeedId(seed.id);
    setIsChatOpen(true);
    setSidePanelTab("detail");
    // On mobile, switch to detail tab
    setMobileTab("detail");
  }, []);

  // Send message: creates + starts a session on first message, sends prompts after
  const handleSendMessage = useCallback(
    async (content: string) => {
      if (session.isStreaming) return;

      let finalContent = content;

      if (!hasInjectedSeedsRef.current) {
        const selectedSeeds =
          seedsPanel.selectedIds.size > 0
            ? seedsPanel.seeds.filter((s: SeedWithRelations) =>
                seedsPanel.selectedIds.has(s.id),
              )
            : [];

        if (selectedSeeds.length > 0) {
          const prefix = buildSeedContextPrefix(selectedSeeds);
          finalContent = prefix + content;
        }
        hasInjectedSeedsRef.current = true;
      }

      const existingSessionId = sessionIdRef.current;

      if (!existingSessionId) {
        // First message: create a new planning session then fire planning:start
        try {
          const title =
            finalContent.trim().slice(0, 80) +
            (finalContent.trim().length > 80 ? "..." : "");

          const seedIds =
            seedsPanel.selectedIds.size > 0
              ? Array.from(seedsPanel.selectedIds)
              : undefined;

          const newSession = await session.createSession({
            title,
            projectId: projectBoard.selectedProjectId || undefined,
            boardId: projectBoard.selectedBoardId || undefined,
            seedIds,
          });

          sessionIdRef.current = newSession.id;
          session.startSession(newSession.id, finalContent, seedIds);
        } catch {
          // Error state handled by usePlanningSession reducer
        }
      } else {
        // Subsequent messages: send prompt over the existing session
        session.sendPrompt(finalContent);
      }
    },
    [
      session,
      seedsPanel.seeds,
      seedsPanel.selectedIds,
      projectBoard.selectedProjectId,
      projectBoard.selectedBoardId,
    ],
  );

  // Reset session and seed injection flag on new conversation
  const handleNewConversation = useCallback(() => {
    hasInjectedSeedsRef.current = false;
    sessionIdRef.current = null;
    if (session.isStreaming) {
      session.cancelSession();
    }
    session.reset();
  }, [session]);

  // ----- Auto-open chat when generation items arrive -----
  const showGeneration = generation.activeItemCount > 0;

  // Use "store previous props in state" pattern (React-endorsed) to detect
  // the transition from no items → items and auto-open the chat panel.
  const [prevShowGeneration, setPrevShowGeneration] = useState(false);
  if (showGeneration !== prevShowGeneration) {
    setPrevShowGeneration(showGeneration);
    if (showGeneration) {
      setIsChatOpen(true);
      setSidePanelTab("chat"); // Show generation in chat tab
    }
  }

  // ----- Confirm generation -----
  const handleConfirmGeneration = useCallback(() => {
    if (!activeColumnId) return;
    generation.confirmGeneration(activeColumnId);
  }, [activeColumnId, generation]);

  // ----- Cancel generation -----
  const handleCancelGeneration = useCallback(() => {
    generation.resetGeneration();
    if (session.isStreaming) {
      session.cancelSession();
    }
    session.reset();
    sessionIdRef.current = null;
    hasInjectedSeedsRef.current = false;
  }, [generation, session]);

  // ----- Provider label for badge -----
  const providerLabel = modelSelector.selectedKey?.provider ?? "";

  // ----- Model selector props (for compact header) -----
  const modelSelectorProps = useMemo(
    () => ({
      providerKeys: modelSelector.providerKeys,
      selectedKeyId: modelSelector.selectedKeyId,
      selectedModel: modelSelector.selectedModel,
      availableModels: modelSelector.availableModels,
      hasKeys: modelSelector.hasKeys,
      isLoading: modelSelector.isLoading,
      onKeyChange: modelSelector.handleKeyChange,
      onModelChange: modelSelector.handleModelChange,
    }),
    [modelSelector],
  );

  return {
    // Project + Board selection
    projects: projectBoard.projects,
    boards: projectBoard.boards,
    selectedProjectId: projectBoard.selectedProjectId,
    selectedBoardId: projectBoard.selectedBoardId,
    isLoadingProjects: projectBoard.isLoadingProjects,
    isLoadingBoards: projectBoard.isLoadingBoards,
    isReady: projectBoard.isReady,
    onProjectChange: projectBoard.onProjectChange,
    onBoardChange: projectBoard.onBoardChange,

    // Seeds panel
    seeds: seedsPanel.filteredSeeds,
    allSeeds: seedsPanel.seeds,
    isSeedsLoading: seedsPanel.isLoading,
    seedsTotalCount: seedsPanel.totalCount,
    seedsFilteredCount: seedsPanel.filteredCount,
    searchQuery: seedsPanel.searchQuery,
    onSearchChange: seedsPanel.setSearchQuery,
    selectedSeedIds: seedsPanel.selectedIds,
    selectedSeedCount: seedsPanel.selectedCount,
    onToggleSeedSelection: seedsPanel.handleToggleSelection,
    onSelectAllSeeds: seedsPanel.handleSelectAll,
    onDeselectAllSeeds: seedsPanel.handleDeselectAll,
    onQuickAddSeed: seedsPanel.handleQuickAdd,
    isCreatingSeed: seedsPanel.isCreating,
    onBulkSeedAction: seedsPanel.handleBulkAction,
    isBulkUpdatingSeeds: seedsPanel.isBulkUpdating,

    // Chat (WebSocket planning session)
    messages,
    isStreaming: session.isStreaming,
    streamingContent: session.streamingContent,
    chatError: session.error,
    isWsConnected: session.isWsConnected,
    sendMessage: handleSendMessage,
    startNewConversation: handleNewConversation,

    // Generation
    previewItems: generation.previewItems,
    activeItemCount: generation.activeItemCount,
    showGeneration,
    updateItem: generation.updateItem,
    removeItem: generation.removeItem,
    isConfirming: generation.isConfirming,
    createdItemIds: generation.createdItemIds,

    // Column selection
    columns,
    activeColumnId,
    onColumnChange: setSelectedColumnId,

    // Layout state
    isChatOpen,
    mobileTab,
    selectedSeedId,
    sidePanelTab,
    onToggleChat: handleToggleChat,
    onMobileTabChange: setMobileTab,
    onSeedClick: handleSeedClick,
    onSidePanelTabChange: setSidePanelTab,
    onClearSelectedSeed: () => setSelectedSeedId(null),

    // Current user and members
    currentUserId,
    members,

    // Model selector
    providerLabel,
    modelSelectorProps,
    selectedModel: modelSelector.selectedModel,
    hasProviderKeys: modelSelector.hasKeys,
    showModelBadge:
      modelSelector.hasKeys &&
      !!modelSelector.selectedModel &&
      messages.length > 0,

    // Actions
    handleConfirmGeneration,
    handleCancelGeneration,
  };
};
