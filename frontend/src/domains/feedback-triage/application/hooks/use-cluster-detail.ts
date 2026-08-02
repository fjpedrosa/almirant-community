"use client";

import { useQuery } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { feedbackTriageKeys } from "./use-triage-keys";
import { mapClusterDetailResponse } from "./cluster-detail-mapper";
import type { TriageClusterDetail } from "../../domain/types";

/**
 * Hook for fetching full detail view of a triage cluster.
 * Includes cluster info, tickets, bug fix attempts, status history, and promotion data.
 *
 * @param clusterId - The cluster ID to fetch, or null to disable the query
 * @returns Query result with TriageClusterDetail
 *
 * @example
 * const { data, isLoading } = useClusterDetailQuery(clusterId);
 * // Access: data?.cluster, data?.tickets, data?.bugFixAttempts, etc.
 */
export const useClusterDetailQuery = (clusterId: string | null) => {
  const scopedKey = useOrgScopedKey(
    feedbackTriageKeys.clusterDetail(clusterId ?? "")
  );

  return useQuery<TriageClusterDetail>({
    queryKey: scopedKey,
    queryFn: async () => {
      const result = await feedbackTriageApi.getClusterDetail(clusterId!);
      return mapClusterDetailResponse(result);
    },
    enabled: !!clusterId,
  });
};
