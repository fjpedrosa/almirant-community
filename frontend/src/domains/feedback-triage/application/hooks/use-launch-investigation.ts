"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { feedbackTriageKeys } from "./use-triage-keys";
import { bugFixAttemptKeys } from "./bug-fix-attempt-keys";
import type {
  LaunchInvestigationErrorPayload,
  LaunchInvestigationResponse,
} from "../../domain/types";

/**
 * Structured parser for launch-investigation failures (A-1874).
 *
 * Backend contract: when `POST /feedback-clusters/:id/launch-investigation`
 * fails, the route returns `{ success: false, error, data: { code, ...ctx } }`
 * — the rich fields (budget, currentStatus, activeAttemptId, allowedStatuses)
 * live under `data`. The `ApiError` thrown by `lib/api/client#request`
 * attaches the full body on `payload` (and aliases it on `body`).
 *
 * This helper is defensive on purpose: React Query, error boundaries and test
 * harnesses may wrap or re-throw errors, so we probe `payload`, `body` and
 * `cause` before giving up. Returns `null` when the error is not a
 * recognisable launch-investigation failure — callers then fall back to
 * `err.message`.
 */
export const parseLaunchInvestigationError = (
  err: unknown
): LaunchInvestigationErrorPayload | null => {
  if (!err || typeof err !== "object") return null;

  const anyErr = err as { body?: unknown; payload?: unknown; cause?: unknown };
  const candidate =
    (anyErr.payload as { data?: unknown } | undefined)?.data ??
    (anyErr.body as { data?: unknown } | undefined)?.data ??
    (anyErr.cause as { data?: unknown } | undefined)?.data ??
    null;

  if (!candidate || typeof candidate !== "object") return null;

  const data = candidate as { code?: string } & Partial<LaunchInvestigationErrorPayload>;
  if (
    data.code === "ACTIVE_ATTEMPT_EXISTS" ||
    data.code === "MAX_ATTEMPTS_REACHED" ||
    data.code === "INVALID_STATE" ||
    data.code === "CLUSTER_EMPTY"
  ) {
    return data as LaunchInvestigationErrorPayload;
  }
  return null;
};

interface UseLaunchInvestigationOptions {
  onSuccess?: (data: LaunchInvestigationResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for launching an investigation on a cluster.
 * Creates a new bug fix attempt and starts an agent job to analyze/fix the issue.
 *
 * Invalidates:
 * 1. feedbackTriageKeys.cluster(clusterId) - includes detail, tickets, attempts scope
 * 2. feedbackTriageKeys.clusters() - global cluster list
 * 3. bugFixAttemptKeys.byCluster(clusterId) - attempts for this specific cluster
 * 4. bugFixAttemptKeys.all - global backoffice bug fix attempts view
 * 5. feedbackTriageKeys.inbox() - inbox may have pending items affected
 *
 * @param options - Optional callbacks for success/error handling
 * @returns Mutation result with mutateAsync function
 *
 * @example
 * const { mutateAsync, isPending } = useLaunchInvestigation({
 *   onSuccess: (data) => console.log('Started investigation:', data.agentJob.id),
 * });
 * await mutateAsync({ clusterId: 'abc' });
 */
export const useLaunchInvestigation = (options?: UseLaunchInvestigationOptions) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clusterId }: { clusterId: string }) =>
      feedbackTriageApi.launchInvestigation(clusterId),
    onSuccess: (data, variables) => {
      const { clusterId } = variables;

      // 1. Invalidate cluster-specific queries (detail, tickets, attempts nested under cluster)
      queryClient.invalidateQueries({
        queryKey: feedbackTriageKeys.cluster(clusterId),
      });

      // 2. Invalidate global clusters list (status may have changed)
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

      // 5. Invalidate inbox (items may be affected by investigation)
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
