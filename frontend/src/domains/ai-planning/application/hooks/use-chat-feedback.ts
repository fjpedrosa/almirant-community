"use client";

import { useCallback, useState } from "react";
import { feedbackApi } from "@/lib/api/client";
import type { QuickFeedbackData } from "@/domains/shared/domain/conversation-types";

interface UseChatFeedbackOptions {
  sessionId?: string;
  projectId?: string;
}

/**
 * Hook for submitting quick feedback on chat messages.
 * Creates a feedback item linked to the specific message and session.
 */
export const useChatFeedback = (options: UseChatFeedbackOptions) => {
  const { sessionId, projectId } = options;
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitFeedback = useCallback(
    async (messageId: string, data: QuickFeedbackData) => {
      if (isPending) return;

      setIsPending(true);
      setError(null);

      try {
        await feedbackApi.createItem({
          category: data.sentiment === "positive" ? "praise" : "improvement",
          title: `Chat feedback: ${data.sentiment}`,
          content: data.content,
          status: "new",
          metadata: {
            source: "chat-quick-feedback",
            messageId,
            sessionId,
            projectId,
            sentiment: data.sentiment,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to submit feedback";
        setError(message);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [sessionId, projectId, isPending],
  );

  const handleFeedback = useCallback(
    (messageId: string, data: QuickFeedbackData) => {
      // Fire and forget - don't block UI
      submitFeedback(messageId, data).catch(() => {
        // Error already captured in state
      });
    },
    [submitFeedback],
  );

  return {
    handleFeedback,
    isPending,
    error,
  };
};
