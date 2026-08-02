"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { feedbackTriageKeys } from "./use-triage-keys";
import type { TriageClusterGroup, PaginatedClustersResponse } from "../../domain/types";

/**
 * Hook for fetching clusters grouped by topic.
 * Returns paginated list of cluster groups for triage review.
 *
 * @param params - Optional URL search params for filtering (status, minItemCount, page, limit)
 * @returns Query result with cluster groups and pagination meta
 *
 * @example
 * const params = new URLSearchParams({ status: 'open', minItemCount: '3' });
 * const { data, isLoading } = useClustersByTopicQuery(params);
 */
export const useClustersByTopicQuery = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(
    feedbackTriageKeys.clusterList(params?.toString() || "")
  );

  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<PaginatedClustersResponse> => {
      const result = await feedbackTriageApi.getClustersByTopic(params);
      return {
        groups: result.data as TriageClusterGroup[],
        meta: result.meta,
      };
    },
    placeholderData: keepPreviousData,
  });
};
