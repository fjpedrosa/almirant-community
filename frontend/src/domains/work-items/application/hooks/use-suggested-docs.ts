"use client";

import { useQuery } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { SuggestedDocument } from "../../domain/types";

const suggestedDocsKeys = {
  byWorkItem: (workItemId: string) =>
    ["suggested-docs", workItemId] as const,
};

export const useSuggestedDocs = (workItemId: string, workItemTitle: string) => {
  const scopedKey = useOrgScopedKey(suggestedDocsKeys.byWorkItem(workItemId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      workItemsApi.getSuggestedDocs(workItemId) as Promise<SuggestedDocument[]>,
    enabled: !!workItemId && workItemTitle.trim().length > 0,
    staleTime: 60_000, // 60 seconds
  });
};
