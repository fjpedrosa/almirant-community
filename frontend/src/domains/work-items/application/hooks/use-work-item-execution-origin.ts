"use client";

import { useQuery } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { WorkItemProvenance } from "../../domain/types";
import { workItemKeys } from "./use-work-items";

export const useWorkItemExecutionOrigin = (
  workItemId: string | null | undefined
) => {
  const scopedKey = useOrgScopedKey([...workItemKeys.detail(workItemId ?? ""), "provenance"]);
  const query = useQuery({
    queryKey: scopedKey,
    queryFn: async () => {
      const result = await workItemsApi.getProvenance(workItemId!);
      return result as WorkItemProvenance;
    },
    enabled: !!workItemId,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const data = query.state.data as WorkItemProvenance | undefined;
      // Refetch faster when there's an active run
      return data?.activeRun ? 5_000 : 30_000;
    },
  });

  return {
    provenance: query.data ?? null,
    lastOrigin: query.data?.lastOrigin ?? null,
    activeRun: query.data?.activeRun ?? null,
    recentJobs: query.data?.recentJobs ?? [],
    sessionSummary: query.data?.sessionSummary ?? null,
    links: query.data?.links ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};
