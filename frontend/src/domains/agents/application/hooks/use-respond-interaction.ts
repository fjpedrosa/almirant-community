"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentJobsApi } from "@/lib/api/client";
import type { RespondInteractionInput } from "../../domain/types";
import { agentJobKeys } from "./use-agent-jobs";

interface RespondInteractionParams {
  jobId: string;
  interactionId: string;
  data: RespondInteractionInput;
}

interface RespondInteractionContext {
  jobId: string;
  workItemId: string;
}

export const useRespondInteraction = (context: RespondInteractionContext) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, interactionId, data }: RespondInteractionParams) =>
      agentJobsApi.respondToInteraction(jobId, interactionId, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: agentJobKeys.workItemInteractions(context.workItemId),
      });
      void queryClient.invalidateQueries({
        queryKey: agentJobKeys.interactions(context.jobId),
      });
      void queryClient.invalidateQueries({
        queryKey: agentJobKeys.pendingCount(),
      });
    },
  });
};
