"use client";

import { useQuery } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import type { WorkerInteraction } from "../../domain/types";
import { agentJobKeys } from "./use-agent-jobs";

export const useWorkerInteractions = (workItemId: string) => {
  return useQuery<WorkerInteraction[]>({
    queryKey: agentJobKeys.workItemInteractions(workItemId),
    queryFn: async () => {
      const result = await workItemsApi.getInteractions(workItemId) as unknown;
      if (Array.isArray(result)) return result as WorkerInteraction[];
      if (result && typeof result === "object" && "data" in result) {
        const data = (result as { data?: unknown }).data;
        if (Array.isArray(data)) return data as WorkerInteraction[];
      }
      return [];
    },
    enabled: !!workItemId,
  });
};
