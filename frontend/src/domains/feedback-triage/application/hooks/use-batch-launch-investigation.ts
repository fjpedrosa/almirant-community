"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { feedbackTriageKeys } from "./use-triage-keys";
import { bugFixAttemptKeys } from "./bug-fix-attempt-keys";
import type { BatchLaunchInvestigationResponse } from "../../domain/types";

export interface UseBatchLaunchInvestigationOptions {
  onSuccess?: (data: BatchLaunchInvestigationResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for launching investigations on multiple clusters in a single request.
 * Wraps `feedbackTriageApi.batchLaunchInvestigation` and takes care of query
 * cache invalidation so the UI reflects both fully-successful and partially-
 * failed batches.
 *
 * Invalidates (on success — i.e. HTTP 200, which is the only success shape
 * the batch endpoint returns, including when every item fails):
 * 1. `feedbackTriageKeys.clusters()` — global cluster list may have new
 *    statuses (investigating / error).
 * 2. `feedbackTriageKeys.inbox()` — inbox items referenced by clusters may
 *    be affected.
 * 3. `bugFixAttemptKeys.all` — backoffice global view needs a refresh.
 * 4. For EVERY id in `variables.clusterIds` — success or failure:
 *    - `feedbackTriageKeys.cluster(clusterId)` — detail/tickets/attempts.
 *    - `bugFixAttemptKeys.byCluster(clusterId)` — cluster-scoped attempts.
 *
 * Why invalidate per-cluster even for failed entries? The backend runs the
 * batch serially and each entry may have caused partial state changes before
 * failing (e.g. the repo call succeeded but enqueue failed and was
 * compensated). Refreshing the cache for every id in the batch keeps the UI
 * honest.
 *
 * @param options - Optional callbacks for success/error handling
 * @returns Mutation result with mutate/mutateAsync
 *
 * @example
 * const { mutateAsync, isPending } = useBatchLaunchInvestigation({
 *   onSuccess: (data) => console.log("Launched", data.summary.launched),
 * });
 * await mutateAsync({ clusterIds: ["a", "b", "c"] });
 */
export const useBatchLaunchInvestigation = (
  options?: UseBatchLaunchInvestigationOptions,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clusterIds }: { clusterIds: string[] }) =>
      feedbackTriageApi.batchLaunchInvestigation(clusterIds),
    onSuccess: (data, variables) => {
      // Global invalidations
      queryClient.invalidateQueries({
        queryKey: feedbackTriageKeys.clusters(),
      });
      queryClient.invalidateQueries({
        queryKey: feedbackTriageKeys.inbox(),
      });
      queryClient.invalidateQueries({
        queryKey: bugFixAttemptKeys.all,
      });

      // Per-cluster invalidations — fire for every id in the batch, including
      // failed ones (partial state changes are possible on failure paths).
      for (const clusterId of variables.clusterIds) {
        queryClient.invalidateQueries({
          queryKey: feedbackTriageKeys.cluster(clusterId),
        });
        queryClient.invalidateQueries({
          queryKey: bugFixAttemptKeys.byCluster(clusterId),
        });
      }

      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });
};
