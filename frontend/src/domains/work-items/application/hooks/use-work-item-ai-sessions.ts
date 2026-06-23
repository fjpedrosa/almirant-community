"use client";

import { useQuery } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { AiSessionsWithSummary } from "../../domain/types";
import { workItemKeys } from "./use-work-items";

export const useWorkItemAiSessions = (workItemId: string | null) => {
  const scopedKey = useOrgScopedKey([...workItemKeys.detail(workItemId ?? ""), "ai-sessions"]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      workItemsApi.getAiSessions(workItemId!) as Promise<AiSessionsWithSummary>,
    enabled: !!workItemId,
  });
};
