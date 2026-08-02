"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { feedbackTriageKeys } from "./use-triage-keys";
import { feedbackKeys } from "@/domains/feedback/application/hooks/use-feedback-traceability";

interface UseReassignClusterOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for reassigning an inbox item to a different cluster.
 * Invalidates inbox and cluster caches on success.
 *
 * @param options - Optional callbacks for success/error handling
 * @returns Mutation result with mutate function
 *
 * @example
 * const { mutate, isPending } = useReassignCluster({
 *   onSuccess: () => toast.success('Item reassigned'),
 * });
 * mutate({ itemId: 'item123', clusterId: 'cluster456' });
 */
export const useReassignCluster = (options?: UseReassignClusterOptions) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      itemId,
      clusterId,
    }: {
      itemId: string;
      clusterId: string;
    }) => feedbackTriageApi.reassignToCluster(itemId, clusterId),
    onSuccess: () => {
      // Invalidate triage caches
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.inbox() });
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.clusters() });
      // Invalidate feedback item caches
      queryClient.invalidateQueries({ queryKey: feedbackKeys.items() });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });
};
