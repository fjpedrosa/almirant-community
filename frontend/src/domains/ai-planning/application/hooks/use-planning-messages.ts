"use client";

import { useCallback, useMemo, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  stripLegacyPlanningControlTokens,
  type UsePlanningSessionReturn,
} from "@/domains/planning/application/hooks/use-planning-session";
import type { ChatMessage, ModelSelectorProps } from "../../domain/types";
import { buildSeedContextPrefix } from "../utils/build-seed-context";
import { planningSessionsApi } from "@/domains/planning/infrastructure/api/planning-api";
import { planningSessionKeys } from "@/domains/planning/domain/query-keys";
import type { usePlanningSessionLifecycle } from "./use-planning-session-lifecycle";
import type { useProjectBoardSelector } from "./use-project-board-selector";
import type { useModelSelector } from "./use-model-selector";

// ---------------------------------------------------------------------------
// Provider label map
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "openai-compatible": "z.ai",
  zai: "z.ai",
  xai: "xAI",
};

export const shouldStartExistingPlanningSession = ({
  existingSessionId,
  sessionStatus,
  hasUserMessages,
  hasPendingQuestion,
}: {
  existingSessionId: string | null;
  sessionStatus?: string;
  hasUserMessages: boolean;
  hasPendingQuestion: boolean;
}) =>
  !!existingSessionId &&
  sessionStatus === "active" &&
  !hasUserMessages &&
  !hasPendingQuestion;

// ---------------------------------------------------------------------------
// Hook: usePlanningMessages
// ---------------------------------------------------------------------------
// Manages message sending, queuing, and mapping PlanningMessage[] to
// ChatMessage[] for presentation. Also derives model-related display values.
//
// Session creation is delegated to lifecycle.createAndTrackSession() to
// avoid duplicating creation logic.
// ---------------------------------------------------------------------------

export const usePlanningMessages = (
  planningSession: UsePlanningSessionReturn,
  lifecycle: ReturnType<typeof usePlanningSessionLifecycle>,
  projectBoard: ReturnType<typeof useProjectBoardSelector>,
  modelSelector: ReturnType<typeof useModelSelector>,
  getAnnotations?: () => Record<string, string>,
) => {
  const queryClient = useQueryClient();
  // ----- Queued messages (sent automatically one-by-one when streaming ends) -----
  // Uses a ref array (FIFO) because the queued values are consumed in an effect
  // and must not trigger cascading renders when cleared.
  const pendingPromptsRef = useRef<string[]>([]);
  const wasStreamingRef = useRef(false);

  useEffect(() => {
    if (wasStreamingRef.current && !planningSession.isStreaming && pendingPromptsRef.current.length > 0) {
      const next = pendingPromptsRef.current.shift()!;
      setTimeout(() => {
        planningSession.sendPrompt(next);
      }, 0);
    }
    wasStreamingRef.current = planningSession.isStreaming;
  }, [planningSession.isStreaming, planningSession]);

  // ----- Map PlanningMessage[] to ChatMessage[] -----
  const messages: ChatMessage[] = useMemo(() => {
    const mapped = planningSession.messages
      .filter((m) => {
        // Hide legacy control-token-only stream artifacts from restored older sessions.
        if (m.role === "assistant" && m.messageType === "stream") {
          const trimmed = stripLegacyPlanningControlTokens(m.content).trim();
          if (!trimmed) return false;
        }
        return true;
      })
      .map((m) => {
        // Strip runner boot messages from assistant content
        if (m.role === "assistant") {
          const cleaned = stripLegacyPlanningControlTokens(
            m.content.replace(/🧪\s*Container listo\.[^\n]*/, "").trimStart(),
          );
          if (cleaned !== m.content) return { ...m, content: cleaned };
        }
        return m;
      })
      .map((m) => ({
        id: m.id,
        role: m.role as ChatMessage["role"],
        content: m.content,
        timestamp: m.createdAt,
        messageType: m.messageType ?? undefined,
        seeds: (m.metadata?.seeds as ChatMessage["seeds"]) ?? undefined,
        metadata: m.metadata,
        deliveryStatus: (m as any).deliveryStatus ?? undefined,
      }));

    // Inject attached seeds into first user message if it has no seeds metadata.
    // This handles session recovery where seeds aren't persisted in message metadata
    // but are loaded separately via the junction table (planningSessionsApi.getSeeds).
    if (lifecycle.attachedSeeds.length > 0) {
      const firstUserIdx = mapped.findIndex((msg) => msg.role === "user");
      if (firstUserIdx !== -1 && !mapped[firstUserIdx]?.seeds?.length) {
        mapped[firstUserIdx] = {
          ...mapped[firstUserIdx]!,
          seeds: lifecycle.attachedSeeds.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description ?? undefined,
          })),
        };
      }
    }

    return mapped;
  }, [planningSession.messages, lifecycle.attachedSeeds]);

  // ----- Send message handler -----
  const handleSendMessage = useCallback(
    async (content: string) => {
      if (planningSession.isStreaming) {
        pendingPromptsRef.current.push(content);
        planningSession.addUserMessage(content, undefined, true);
        return;
      }

      // Add user message to chat immediately (show original, not seed-prefixed)
      // Skip when answering a pending question — ANSWER_QUESTION handles adding
      // the user answer in the correct timeline position (after graduated content).
      if (!planningSession.pendingQuestion) {
        const attachedSeeds = lifecycle.attachedSeeds.length > 0
          ? lifecycle.attachedSeeds.map((s) => ({ id: s.id, title: s.title, description: s.description ?? undefined }))
          : undefined;
        planningSession.addUserMessage(content, attachedSeeds);
      }

      let finalContent = content;

      // Inject seed context prefix if available and not yet injected.
      // When annotations exist, rebuild the prefix to include them.
      const seedPrefix = lifecycle.consumeSeedContextPrefix();
      if (seedPrefix) {
        const annotations = getAnnotations?.();
        const hasAnnotations =
          annotations && Object.keys(annotations).length > 0;
        if (hasAnnotations && lifecycle.attachedSeeds.length > 0) {
          finalContent =
            buildSeedContextPrefix(lifecycle.attachedSeeds, annotations) +
            content;
        } else {
          finalContent = seedPrefix + content;
        }
      }

      const existingSessionId = lifecycle.getSessionId();
      // Use "no user messages yet" instead of "no messages at all" because the prewarm
      // job emits system.info assistant messages ("Container listo...") that get loaded
      // into state. Those assistant-only messages must not prevent us from sending
      // planning:start (which converts the prewarm job and passes the user's prompt).
      const hasUserMessages = planningSession.messages.some((m) => m.role === "user");
      const shouldStartExistingSession = shouldStartExistingPlanningSession({
        existingSessionId,
        sessionStatus: planningSession.session?.status,
        hasUserMessages,
        hasPendingQuestion: !!planningSession.pendingQuestion,
      });

      // Fire-and-forget: generate AI title on the first user message
      const generateTitleForSession = (sessionId: string) => {
        void planningSessionsApi.generateTitle(sessionId, content, modelSelector.selectedKeyId || undefined).then(() => {
          void queryClient.invalidateQueries({ queryKey: planningSessionKeys.lists() });
        }).catch(() => { /* best-effort */ });
      };

      console.info("[planning-messages] sendMessage flow:", {
        existingSessionId: !!existingSessionId,
        shouldStart: shouldStartExistingSession,
        sessionStatus: planningSession.session?.status,
        messagesLength: planningSession.messages.length,
        hasUserMessages,
        hasPendingQuestion: !!planningSession.pendingQuestion,
        codingAgent: modelSelector.selectedCodingAgent,
      });

      if (!existingSessionId) {
        // Delegate session creation to lifecycle (single source of truth)
        try {
          const title =
            finalContent.trim().slice(0, 80) +
            (finalContent.trim().length > 80 ? "..." : "");

          const { id } = await lifecycle.createAndTrackSession(title);
          const agentConfig = modelSelector.selectedCodingAgent
            ? { codingAgent: modelSelector.selectedCodingAgent, provider: modelSelector.selectedKey?.provider, model: modelSelector.selectedModel }
            : undefined;
          planningSession.startSession(id, finalContent, undefined, agentConfig);
          generateTitleForSession(id);
        } catch {
          // Error state handled by usePlanningSession reducer
        }
      } else if (shouldStartExistingSession) {
        // Session was created via "Iniciar" button with default title — generate AI title now
        const agentConfig = modelSelector.selectedCodingAgent
          ? { codingAgent: modelSelector.selectedCodingAgent, provider: modelSelector.selectedKey?.provider, model: modelSelector.selectedModel }
          : undefined;
        console.info("[planning-messages] calling startSession with agentConfig:", agentConfig);
        planningSession.startSession(existingSessionId, finalContent, undefined, agentConfig);
        generateTitleForSession(existingSessionId);
      } else {
        planningSession.sendPrompt(finalContent);
      }
    },
    [
      planningSession,
      lifecycle,
      getAnnotations,
      queryClient,
    ],
  );

  // ----- Provider label -----
  const providerLabel =
    PROVIDER_LABELS[modelSelector.selectedKey?.provider ?? ""] ?? "";

  // ----- Model selector props (for compact header) -----
  const modelSelectorProps: ModelSelectorProps = useMemo(
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

  // ----- Active labels -----
  const activeProjectName = useMemo(() => {
    if (!projectBoard.selectedProjectId) return undefined;
    return projectBoard.projects.find(
      (p) => p.id === projectBoard.selectedProjectId,
    )?.name;
  }, [projectBoard.projects, projectBoard.selectedProjectId]);

  const activeModelLabel = useMemo(() => {
    if (!modelSelector.selectedKey || !modelSelector.selectedModel)
      return undefined;
    const providerName =
      PROVIDER_LABELS[modelSelector.selectedKey.provider] ??
      modelSelector.selectedKey.provider;
    return `${providerName} / ${modelSelector.selectedModel}`;
  }, [modelSelector.selectedKey, modelSelector.selectedModel]);

  const showModelBadge =
    modelSelector.hasKeys &&
    !!modelSelector.selectedModel &&
    messages.length > 0;

  return {
    messages,
    streamingContent: planningSession.streamingContent,
    streamingBlocks: planningSession.streamingBlocks,
    completedTurnBlocks: planningSession.completedTurnBlocks,
    isStreaming: planningSession.isStreaming,
    latestActivity: planningSession.latestActivity,
    pendingUserMessage: planningSession.pendingUserMessage,
    sendMessage: handleSendMessage,
    providerLabel,
    selectedModel: modelSelector.selectedModel,
    showModelBadge,
    modelSelectorProps,
    activeProjectName,
    activeModelLabel,
    selectedCodingAgent: modelSelector.selectedCodingAgent,
    handleCodingAgentChange: modelSelector.handleCodingAgentChange,
  };
};
