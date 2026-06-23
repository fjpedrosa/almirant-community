"use client";

import { useQuery } from "@tanstack/react-query";
import { agentJobKeys } from "./use-agent-jobs";

// This hook tracks the count of pending interaction questions.
// The count is intended to be refreshed via WebSocket event invalidation.
// A dedicated backend endpoint can replace the placeholder queryFn when available.
export const usePendingQuestionsCount = () => {
  return useQuery<number>({
    queryKey: agentJobKeys.pendingCount(),
    queryFn: async () => 0,
    staleTime: Infinity,
  });
};
