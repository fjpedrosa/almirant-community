"use client";

import { useQuery } from "@tanstack/react-query";
import { planningSessionKeys } from "../../domain/query-keys";
import { planningSessionsApi } from "../../infrastructure/api/planning-api";
import type { PlanningSession, PlanningMessage } from "../../domain/types";
import type { AgentLogChunk } from "@/domains/shared/domain/types";

/**
 * Convert agent_job_logs transcript chunks into PlanningMessage[] for replay.
 * Groups consecutive chunks of the same role (user_input → user, text → assistant)
 * into single messages.
 */
const chunksToMessages = (
  chunks: AgentLogChunk[],
  sessionId: string,
): PlanningMessage[] => {
  const messages: PlanningMessage[] = [];
  let currentRole: "user" | "assistant" | null = null;
  let currentContent = "";
  let currentTimestamp = "";
  let messageIndex = 0;

  const flush = () => {
    if (currentRole && currentContent.trim()) {
      messages.push({
        id: `replay-${messageIndex++}`,
        sessionId,
        role: currentRole,
        content: currentContent.trim(),
        messageType: currentRole === "user" ? "user" : "stream",
        inputTokens: null,
        outputTokens: null,
        metadata: {},
        createdAt: currentTimestamp,
      });
    }
    currentContent = "";
  };

  for (const chunk of chunks) {
    if (chunk.phase !== "transcript") continue;

    const role: "user" | "assistant" =
      chunk.contentType === "user_input" ? "user" : "assistant";

    // Skip thinking and tool_use for the replay chat bubbles
    if (chunk.contentType === "thinking" || chunk.contentType === "tool_use") {
      continue;
    }

    if (role !== currentRole) {
      flush();
      currentRole = role;
      currentTimestamp = chunk.timestamp;
    }

    currentContent += chunk.message;
  }
  flush();

  return messages;
};

export const useSessionReplay = (sessionId: string) => {
  const sessionQuery = useQuery({
    queryKey: planningSessionKeys.detail(sessionId),
    queryFn: () =>
      planningSessionsApi.get(sessionId) as Promise<PlanningSession>,
    enabled: !!sessionId,
  });

  // Latest job output resolved in ONE call (jobs -> output collapsed backend-side)
  // instead of chaining list-jobs then fetch-output round-trips.
  const outputQuery = useQuery({
    queryKey: planningSessionKeys.latestOutput(sessionId),
    queryFn: () => planningSessionsApi.getLatestOutput(sessionId),
    enabled: !!sessionId,
  });

  const messages =
    outputQuery.data?.chunks && sessionId
      ? chunksToMessages(outputQuery.data.chunks, sessionId)
      : [];

  return {
    session: sessionQuery.data ?? null,
    messages,
    isLoading: sessionQuery.isLoading || outputQuery.isLoading,
    error: sessionQuery.error ?? outputQuery.error ?? null,
  };
};
