"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { feedbackTriageKeys } from "./use-triage-keys";
import type { CreateClusterInput, CreateClusterResponse } from "../../domain/types";

interface UseCreateClusterOptions {
  onSuccess?: (data: CreateClusterResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for manually creating a new cluster.
 * Invalidates cluster and inbox caches on success.
 *
 * @param options - Optional callbacks for success/error handling
 * @returns Mutation result with mutate function
 *
 * @example
 * const { mutate, isPending } = useCreateCluster({
 *   onSuccess: (data) => console.log('Created cluster:', data.id),
 * });
 * mutate({ title: 'Login Issues', summary: 'Users cannot login', feedbackItemIds: ['item1', 'item2'] });
 */
export const useCreateCluster = (options?: UseCreateClusterOptions) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateClusterInput) =>
      feedbackTriageApi.createCluster(input),
    onSuccess: (data) => {
      // Invalidate cluster list
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.clusters() });
      // Invalidate inbox (items may have been assigned to this cluster)
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.inbox() });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });
};
