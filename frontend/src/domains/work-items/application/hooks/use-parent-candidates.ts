"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { workItemKeys } from "./use-work-items";
import type { WorkItemType, WorkItemWithRelations } from "../../domain/types";

const PARENT_TYPES: WorkItemType[] = ["epic", "feature", "story"];
const DEFAULT_LIMIT = 500;

export const useParentCandidates = (projectId: string | undefined) => {
  const queries = useQueries({
    queries: PARENT_TYPES.map((type) => ({
      queryKey: [...workItemKeys.all, "parent-candidates", projectId ?? "none", type] as const,
      enabled: !!projectId,
      queryFn: async () => {
        if (!projectId) return [] as WorkItemWithRelations[];
        const params = new URLSearchParams({
          page: "1",
          limit: String(DEFAULT_LIMIT),
          projectId,
          type,
        });
        return workItemsApi.list(params) as Promise<WorkItemWithRelations[]>;
      },
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);

  const parents = useMemo(() => {
    const items = queries.flatMap((q) => (q.data ?? []) as WorkItemWithRelations[]);
    return items
      .filter((item) => !item.columnIsDone)
      .map((item) => ({ id: item.id, title: item.title, type: item.type }));
  }, [queries]);

  return { parents, isLoading };
};

