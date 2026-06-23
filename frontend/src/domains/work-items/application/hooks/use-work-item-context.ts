"use client";

import { useQuery } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { workItemKeys } from "./use-work-items";
import type { WorkItemContextResponse } from "../../domain/types";

export const workItemContextKeys = {
  context: (workItemId: string) =>
    [...workItemKeys.detail(workItemId), "context"] as const,
};

export const useWorkItemContext = (workItemId: string | null) => {
  const scopedKey = useOrgScopedKey(workItemContextKeys.context(workItemId ?? ""));
  const query = useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      workItemsApi.getContext(workItemId!) as Promise<WorkItemContextResponse>,
    enabled: !!workItemId,
    staleTime: 30_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,

    // Convenience accessors so consumers can destructure directly
    dependenciesData: query.data?.dependencies,
    linkedDocumentsData: query.data?.documents,
    suggestedDocsData: query.data?.suggestedDocs,
    aiSessionsData: query.data?.aiSessions,
    childrenData: query.data?.children,
    commitsData: query.data?.commits,

    isLoadingDependencies: query.isLoading,
    isLoadingLinkedDocs: query.isLoading,
    isLoadingSuggestedDocs: query.isLoading,
    isLoadingChildren: query.isLoading,
    isLoadingCommits: query.isLoading,
  };
};
