"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import type { AgentLogChunk } from "@/domains/shared/domain/types";
import type { ChatMessage, UserMessageSeed } from "../../domain/types";

interface AgentJobOutput {
  sessionId: string | null;
  status: string;
  chunks: AgentLogChunk[];
  nextCursor: number | null;
}

/**
 * Reconstruct ChatMessage[] from agent_job_logs for a planning job.
 *
 * Groups transcript-phase chunks by content_type:
 * - `user_input` events → user message (with seeds from payload)
 * - Consecutive `text`/`thinking`/`tool_call`/`subagent` events → single assistant turn
 *
 * Returns the same ChatMessage[] shape that usePlanningMessages produces,
 * so the chat UI can consume it without changes.
 */
export const usePlanningChatFromLogs = (jobId: string | null | undefined) => {
  const query = useQuery({
    queryKey: ["planning-chat-logs", jobId],
    queryFn: () =>
      request<AgentJobOutput>(
        `/agent-jobs/${jobId!}/output?limit=500&phase=transcript`,
      ),
    enabled: !!jobId,
    staleTime: 5_000,
  });

  const messages: ChatMessage[] = useMemo(() => {
    if (!query.data?.chunks?.length) return [];
    return chunksToMessages(query.data.chunks);
  }, [query.data]);

  return {
    messages,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
};

/**
 * Convert an ordered list of AgentLogChunks into ChatMessage[].
 *
 * The algorithm walks chunks sequentially:
 * - When it encounters a `user_input` contentType, it starts a new user message.
 * - All other contentTypes (text, thinking, tool_use, etc.) are grouped into
 *   assistant messages. Consecutive assistant chunks are merged into a single turn.
 * - A new assistant turn starts after each user_input chunk, or when there's a
 *   significant gap in sequence numbers.
 */
const chunksToMessages = (chunks: AgentLogChunk[]): ChatMessage[] => {
  const messages: ChatMessage[] = [];
  let currentAssistantContent = "";
  let currentAssistantStart: string | null = null;
  let messageCounter = 0;

  const flushAssistant = () => {
    if (currentAssistantContent.trim()) {
      messages.push({
        id: `log-assistant-${messageCounter++}`,
        role: "assistant",
        content: currentAssistantContent.trim(),
        timestamp: currentAssistantStart ?? new Date().toISOString(),
      });
    }
    currentAssistantContent = "";
    currentAssistantStart = null;
  };

  for (const chunk of chunks) {
    // Only process transcript-phase chunks
    if (chunk.phase !== "transcript") continue;

    if (chunk.contentType === "user_input") {
      // Flush any pending assistant content
      flushAssistant();

      // Extract seeds from payload if present
      const seeds = chunk.payload?.seeds as UserMessageSeed[] | undefined;

      messages.push({
        id: `log-user-${messageCounter++}`,
        role: "user",
        content: chunk.message,
        timestamp: chunk.timestamp,
        seeds: seeds?.length ? seeds : undefined,
        metadata: chunk.payload ?? undefined,
      });
    } else {
      // Assistant content — accumulate
      if (!currentAssistantStart) {
        currentAssistantStart = chunk.timestamp;
      }

      // For thinking blocks, we could tag the message, but for now
      // we merge everything into content. The streaming blocks renderer
      // on the session page will handle rich rendering separately.
      if (chunk.contentType === "thinking") {
        // Skip thinking content in the chat view — it's shown via streaming blocks
        continue;
      }

      if (chunk.contentType === "tool_use") {
        // Skip tool_use in chat content — shown via streaming blocks
        continue;
      }

      // text content (or no contentType for legacy data)
      if (chunk.message) {
        currentAssistantContent += chunk.message;
      }
    }
  }

  // Flush remaining assistant content
  flushAssistant();

  return messages;
};
