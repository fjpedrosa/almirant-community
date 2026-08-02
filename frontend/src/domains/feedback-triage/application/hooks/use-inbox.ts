"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { feedbackTriageKeys } from "./use-triage-keys";
import type { TriageInboxItem, PaginatedInboxResponse } from "../../domain/types";

/**
 * Hook for fetching the triage inbox items.
 * Returns paginated list of feedback items pending review.
 *
 * @param params - Optional URL search params for filtering (status, aiDomain, page, limit)
 * @returns Query result with items and pagination meta
 *
 * @example
 * const params = new URLSearchParams({ status: 'pending', page: '1', limit: '20' });
 * const { data, isLoading } = useInboxQuery(params);
 */
export const useInboxQuery = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(
    feedbackTriageKeys.inboxList(params?.toString() || "")
  );

  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<PaginatedInboxResponse> => {
      const result = await feedbackTriageApi.getInbox(params);
      return {
        items: result.data as TriageInboxItem[],
        meta: result.meta,
      };
    },
    placeholderData: keepPreviousData,
  });
};
