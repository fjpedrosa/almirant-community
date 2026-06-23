"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { WorkItemWithRelations } from "../../domain/types";
import { workItemKeys } from "./use-work-items";

export const useWorkItemHierarchy = (parentId: string) => {
  const scopedKey = useOrgScopedKey([...workItemKeys.all, "hierarchy", parentId]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => workItemsApi.getHierarchy(parentId) as Promise<WorkItemWithRelations[]>,
    enabled: !!parentId,
  });
};

export const useChangeParent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      workItemsApi.changeParent(id, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });
};
