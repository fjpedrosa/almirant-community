"use client";

import { useQuery } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { workItemKeys } from "./use-work-items";
import type { WorkItemEvent } from "../../domain/types";

/**
 * Fetches the aggregated event history for all direct children of a parent work item.
 *
 * The backend endpoint (`/work-items/:id/children-events`) returns events enriched
 * with a `taskId` field so callers can identify which child each event belongs to.
 *
 * Show-all / show-less toggle logic belongs in the container, not here - simply pass
 * the desired limit via `options.limit` (e.g. 10 for collapsed, 200 for expanded).
 *
 * @example
 * // In a container:
 * const { data: events, isLoading } = useChildrenEvents(parentId, {
 *   enabled: isHistoryTabActive,
 *   limit: showAll ? 200 : 10,
 * });
 */
export const useChildrenEvents = (
  parentId: string | null,
  options?: { enabled?: boolean; limit?: number }
) => {
  const scopedKey = useOrgScopedKey([...workItemKeys.all, "children-events", parentId, options?.limit ?? null]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.limit != null) params.set("limit", String(options.limit));

      const result = await workItemsApi.getChildrenEvents(parentId!, params) as unknown;

      if (Array.isArray(result)) return result as WorkItemEvent[];
      if (result && typeof result === "object" && "data" in result) {
        const data = (result as { data?: unknown }).data;
        if (Array.isArray(data)) return data as WorkItemEvent[];
      }
      return [];
    },
    enabled: !!parentId && options?.enabled !== false,
    staleTime: 5 * 60 * 1000, // 5 minutes - history changes slowly
  });
};
