"use client";

import { useQuery } from "@tanstack/react-query";
import { adminFeedbackApi } from "@/lib/api/client";
import { bugFixAttemptKeys } from "./bug-fix-attempt-keys";
import type { BugFixAttemptSummary } from "../../domain/types";

/**
 * Hook for fetching bug fix attempts for a specific cluster.
 * Cross-domain hook that consumes adminFeedbackApi (allowed at hook level per DDD).
 *
 * @param clusterId - The cluster ID to fetch attempts for, or null to disable the query
 * @returns Query result with array of BugFixAttemptSummary
 *
 * @example
 * const { data: attempts, isLoading } = useClusterBugFixAttempts(clusterId);
 */
export const useClusterBugFixAttempts = (clusterId: string | null) => {
  // Note: No org-scope needed since cluster ID is already specific
  return useQuery<BugFixAttemptSummary[]>({
    queryKey: bugFixAttemptKeys.byCluster(clusterId ?? ""),
    queryFn: async () => {
      const result = await adminFeedbackApi.getBugFixAttemptsByCluster(clusterId!);
      return result;
    },
    enabled: !!clusterId,
  });
};
