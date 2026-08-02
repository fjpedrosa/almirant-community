"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { feedbackTriageKeys } from "./use-triage-keys";
import { bugFixAttemptKeys } from "./bug-fix-attempt-keys";
import type {
  AbortInvestigationErrorPayload,
  AbortInvestigationResponse,
} from "../../domain/types";

/**
 * Defensive parser for abort-investigation failures (A-1932).
 *
 * Backend contract: when `POST /feedback-clusters/:id/abort-investigation`
 * fails, the route returns `{ success: false, error, data: { code, ...ctx } }`
 * — the rich fields (currentStatus, allowedStatuses) live under `data`. The
 * `ApiError` thrown by `lib/api/client#request` attaches the full body on
 * `payload` (and aliases it on `body`).
 *
 * Mirrors `parseLaunchInvestigationError`: React Query, error boundaries and
 * test harnesses may wrap or re-throw errors, so we probe `payload`, `body`
 * and `cause` before giving up. Returns `null` when the error is not a
 * recognisable abort-investigation failure — callers then fall back to
 * `err.message`.
 */
export const parseAbortInvestigationError = (
  err: unknown
): AbortInvestigationErrorPayload | null => {
  if (!err || typeof err !== "object") return null;

  const anyErr = err as { body?: unknown; payload?: unknown; cause?: unknown };
  const candidate =
    (anyErr.payload as { data?: unknown } | undefined)?.data ??
    (anyErr.body as { data?: unknown } | undefined)?.data ??
    (anyErr.cause as { data?: unknown } | undefined)?.data ??
    null;

  if (!candidate || typeof candidate !== "object") return null;

  const data = candidate as { code?: string } & Partial<AbortInvestigationErrorPayload>;
  if (data.code === "INVALID_STATE") {
    return data as AbortInvestigationErrorPayload;
  }
  return null;
};

interface UseAbortInvestigationOptions {
  onSuccess?: (data: AbortInvestigationResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for aborting an active investigation on a cluster (A-1930).
 * Marks the active bug_fix_attempt as failed and resets the cluster to `open`.
 *
 * Invalidates the same 5 query keys as `useLaunchInvestigation`:
 * 1. feedbackTriageKeys.cluster(clusterId) - includes detail, tickets, attempts scope
 * 2. feedbackTriageKeys.clusters() - global cluster list
 * 3. bugFixAttemptKeys.byCluster(clusterId) - attempts for this specific cluster
 * 4. bugFixAttemptKeys.all - global backoffice bug fix attempts view
 * 5. feedbackTriageKeys.inbox() - inbox may have items affected by the abort
 *
 * @param options - Optional callbacks for success/error handling
 * @returns Mutation result with mutateAsync function
 *
 * @example
 * const { mutateAsync, isPending } = useAbortInvestigation({
 *   onSuccess: (data) => console.log('Aborted investigation on:', data.cluster.id),
 * });
 * await mutateAsync({ clusterId: 'abc' });
 */
export const useAbortInvestigation = (options?: UseAbortInvestigationOptions) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clusterId }: { clusterId: string }) =>
      feedbackTriageApi.abortInvestigation(clusterId),
    onSuccess: (data, variables) => {
      const { clusterId } = variables;

      // 1. Invalidate cluster-specific queries (detail, tickets, attempts nested under cluster)
      queryClient.invalidateQueries({
        queryKey: feedbackTriageKeys.cluster(clusterId),
      });

      // 2. Invalidate global clusters list (status reset to `open`)
      queryClient.invalidateQueries({
        queryKey: feedbackTriageKeys.clusters(),
      });

      // 3. Invalidate bug fix attempts for this cluster (cross-domain)
      queryClient.invalidateQueries({
        queryKey: bugFixAttemptKeys.byCluster(clusterId),
      });

      // 4. Invalidate all bug fix attempts (backoffice global view)
      queryClient.invalidateQueries({
        queryKey: bugFixAttemptKeys.all,
      });

      // 5. Invalidate inbox (items may be affected by abort)
      queryClient.invalidateQueries({
        queryKey: feedbackTriageKeys.inbox(),
      });

      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });
};
