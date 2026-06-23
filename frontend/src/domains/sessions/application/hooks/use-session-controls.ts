"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentJobsApi } from "@/lib/api/client";
import { isAgentSessionActive } from "../../domain/utils";
import { sessionKeys } from "../../domain/query-keys";
import type { AgentJobStatus } from "@/domains/agents/domain/types";

interface UseSessionControlsParams {
  jobId: string;
  status: AgentJobStatus;
}

export const useSessionControls = ({
  jobId,
  status,
}: UseSessionControlsParams) => {
  const queryClient = useQueryClient();
  const isActive = isAgentSessionActive(status);

  const cancelMutation = useMutation({
    mutationFn: () => agentJobsApi.cancel(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });

  return {
    isActive,
    isCancelling: cancelMutation.isPending,
    onStop: () => cancelMutation.mutate(),
  };
};
