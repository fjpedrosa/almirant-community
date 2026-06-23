"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { WorkItemEvent } from "../../domain/types";
import { workItemKeys } from "./use-work-items";

export const useWorkItemEvents = (
  workItemId: string | null,
  opts?: { limit?: number }
) => {
  const queryClient = useQueryClient();
  const scopedKey = useOrgScopedKey([...workItemKeys.detail(workItemId ?? ""), "events", opts?.limit ?? null]);

  const query = useQuery({
    queryKey: scopedKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.limit != null) params.set("limit", String(opts.limit));
      const result = await workItemsApi.getEvents(workItemId!, params) as unknown;
      if (Array.isArray(result)) return result as WorkItemEvent[];
      if (result && typeof result === "object" && "data" in result) {
        const data = (result as { data?: unknown }).data;
        if (Array.isArray(data)) return data as WorkItemEvent[];
      }
      return [];
    },
    enabled: !!workItemId,
  });

  useEffect(() => {
    if (!workItemId || !query.isSuccess) return;
    // Participant stacks depend on event history.
    queryClient.invalidateQueries({
      queryKey: [...workItemKeys.all, "participants"],
    });
  }, [workItemId, query.isSuccess, query.dataUpdatedAt, queryClient]);

  return query;
};
