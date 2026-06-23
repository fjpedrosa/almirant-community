"use client";

import { useQuery } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { workItemKeys } from "./use-work-items";
import type { WorkItemWithRelations } from "../../domain/types";

export const useWorkItemChildren = (parentId: string, enabled: boolean) => {
  const scopedKey = useOrgScopedKey([...workItemKeys.all, "children", parentId]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => {
      const params = new URLSearchParams({ parentId });
      return workItemsApi.list(params) as Promise<WorkItemWithRelations[]>;
    },
    enabled: !!parentId && enabled,
  });
};
