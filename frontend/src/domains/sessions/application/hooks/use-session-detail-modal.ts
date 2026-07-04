"use client";

import { useMemo } from "react";
import { useDetailPanelUrl } from "@/domains/shared/application/hooks/use-detail-panel-url";
import { useLiveTimer } from "@/domains/agents/application/hooks/use-live-timer";
import {
  useSessionDetail,
  useSessionOutput,
  isAgentSessionActive,
} from "./use-session-detail";
import { useSessionTranscriptStream } from "./use-session-transcript-stream";
import { useSessionEventTimeline } from "./use-session-event-timeline";
import { useSessionControls } from "./use-session-controls";
import { useSessionInteractions } from "./use-session-interactions";
import { useResourceTimeline } from "./use-resource-timeline";
import { useTaskIdResolution } from "./use-task-id-resolution";
import { useThinkingCollapse } from "./use-thinking-collapse";
import { useChatFeedback } from "@/domains/ai-planning/application/hooks/use-chat-feedback";
import { parseChunksToStreamingBlocks } from "../utils/chunk-to-block-parser";
import { chunksToConversationMessages } from "../utils/chunks-to-conversation-messages";
import { getSessionDurationMs, formatDuration } from "../../domain/utils";
import { computeSessionModalGates } from "../../domain/session-modal-gating";

const SESSION_DETAIL_URL_OPTIONS = {
  legacyParamNames: ["sessionId"],
} as const;

export const useSessionDetailModal = () => {
  const { selectedItemId, isOpen, open, onOpenChange } =
    useDetailPanelUrl("jobId", SESSION_DETAIL_URL_OPTIONS);

  const { data: detail, isLoading: isDetailLoading } =
    useSessionDetail(selectedItemId);

  const status = detail?.job.status ?? null;
  const isLive = isAgentSessionActive(status);

  // The jobId is known from the URL (`selectedItemId`), so the secondary queries
  // fire in PARALLEL with `detail` instead of waterfalling behind it. Only `isOpen`
  // gates them; data that genuinely needs `detail` (provider for display, isLive for
  // poll cadence) is still passed through and refines the query once detail arrives.
  const gates = computeSessionModalGates(isOpen);

  const { chunks, rawChunks, isLoading: isOutputLoading } = useSessionOutput(
    selectedItemId,
    status,
    { enabled: gates.output, provider: detail?.job.provider ?? null }
  );

  const { transcript, segments, isStreaming, isLoading: isTranscriptLoading } =
    useSessionTranscriptStream(detail?.job.id, status, { enabled: isOpen });

  const { phases } = useSessionEventTimeline(chunks, detail?.job.jobType, isLive);

  const { data: resourceTimeline, isLoading: isResourceTimelineLoading } =
    useResourceTimeline(selectedItemId, {
      enabled: gates.resourceTimeline,
      isLive,
    });

  const streamingBlocks = useMemo(
    () => parseChunksToStreamingBlocks(chunks, isLive),
    [chunks, isLive]
  );
  const hasBackgroundAgentsWaiting = useMemo(() => {
    let waiting = false;

    for (const chunk of chunks) {
      if (
        chunk.phase === "session" &&
        chunk.eventType === "session.waiting_background_agents"
      ) {
        waiting = true;
        continue;
      }

      if (
        chunk.phase === "session" &&
        chunk.eventType === "session.background_agent_resumed"
      ) {
        waiting = false;
        continue;
      }

      if (
        chunk.phase === "session" &&
        chunk.eventType === "session.background_agents_completed"
      ) {
        waiting = false;
        continue;
      }

      if (
        chunk.phase === "session" &&
        chunk.eventType === "session.background_agent_timeout"
      ) {
        waiting = false;
        continue;
      }

      if (chunk.phase === "finish") {
        waiting = false;
      }
    }

    return isLive && waiting;
  }, [chunks, isLive]);
  const conversationChunks = useMemo(
    () => [
      ...rawChunks.filter(
        (chunk) =>
          chunk.phase === "session" && chunk.eventType === "prompt.sent",
      ),
      ...chunks.filter(
        (chunk) =>
          !(chunk.phase === "session" && chunk.eventType === "prompt.sent"),
      ),
    ],
    [chunks, rawChunks],
  );
  const messages = useMemo(
    () => chunksToConversationMessages(conversationChunks),
    [conversationChunks],
  );

  const taskIdMap = useTaskIdResolution(transcript);

  const thinkingCollapse = useThinkingCollapse(segments);
  const hasThinkingBlocks =
    thinkingCollapse.hasThinkingBlocks ||
    streamingBlocks.some((block) => block.type === "thinking");

  const currentTime = useLiveTimer(isLive);

  const duration = detail
    ? getSessionDurationMs(
        detail.job.startedAt,
        detail.job.completedAt ?? detail.job.failedAt ?? null,
        detail.job.durationMs,
        currentTime
      )
    : null;

  const elapsedTime = formatDuration(duration);

  const controls = useSessionControls({
    jobId: selectedItemId ?? "",
    status: status ?? "queued",
  });

  const interactions = useSessionInteractions(
    selectedItemId,
    isLive,
  );

  const chatFeedback = useChatFeedback({
    sessionId: selectedItemId ?? undefined,
    projectId: detail?.project?.id,
  });

  return {
    selectedItemId,
    isOpen,
    open,
    onOpenChange,
    detail: detail ?? null,
    output: { chunks },
    isLive,
    isLoading: isDetailLoading || isOutputLoading,
    currentTime,
    duration,
    messages,
    transcript,
    segments,
    streamingBlocks,
    hasBackgroundAgentsWaiting,
    isStreaming,
    isTranscriptLoading,
    taskIdMap,
    phases,
    resourceTimeline: resourceTimeline ?? null,
    isResourceTimelineLoading,
    isActive: controls.isActive,
    isCancelling: controls.isCancelling,
    elapsedTime,
    onStop: controls.onStop,
    pendingInteraction: interactions.pendingInteraction,
    answerText: interactions.answerText,
    onAnswerChange: interactions.setAnswerText,
    onRespond: interactions.respond,
    onRespondWithOption: interactions.respondWithOption,
    isResponding: interactions.isResponding,
    allThinkingCollapsed: thinkingCollapse.allCollapsed,
    hasThinkingBlocks,
    onToggleAllThinking: thinkingCollapse.toggleAll,
    isThinkingOpen: thinkingCollapse.isOpen,
    onThinkingToggle: thinkingCollapse.toggleOne,
    onFeedback: chatFeedback.handleFeedback,
  };
};
