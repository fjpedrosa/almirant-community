"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { feedbackTriageKeys } from "./use-triage-keys";
import { feedbackKeys } from "@/domains/feedback/application/hooks/use-feedback-traceability";
import type { PromoteClusterInput, PromoteClusterResponse } from "../../domain/types";

interface UsePromoteClusterOptions {
  onSuccess?: (data: PromoteClusterResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for promoting a cluster to a work item.
 * Invalidates both clusters and inbox caches on success.
 *
 * @param options - Optional callbacks for success/error handling
 * @returns Mutation result with mutate function
 *
 * @example
 * const { mutate, isPending } = usePromoteCluster({
 *   onSuccess: (data) => console.log('Created work item:', data.workItem.id),
 * });
 * mutate({ clusterId: 'abc123', input: { workItemType: 'story', title: 'New feature', boardId: '...', boardColumnId: '...' } });
 */
export const usePromoteCluster = (options?: UsePromoteClusterOptions) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      clusterId,
      input,
    }: {
      clusterId: string;
      input: PromoteClusterInput;
    }) => feedbackTriageApi.promoteCluster(clusterId, input),
    onSuccess: (data) => {
      // Invalidate triage caches
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.clusters() });
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.inbox() });
      // Invalidate feedback caches (promotions list, etc.)
      queryClient.invalidateQueries({ queryKey: feedbackKeys.promotions() });
      queryClient.invalidateQueries({ queryKey: feedbackKeys.items() });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });
};
