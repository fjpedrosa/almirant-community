"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import type { WorkItemDependenciesResponse } from "../../domain/types";
import { workItemContextKeys } from "./use-work-item-context";

const dependencyKeys = {
  byWorkItem: (workItemId: string) => ["dependencies", workItemId] as const,
};

export const useDependencies = (workItemId: string) => {
  const scopedKey = useOrgScopedKey(dependencyKeys.byWorkItem(workItemId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      workItemsApi.getDependencies(workItemId) as Promise<WorkItemDependenciesResponse>,
    enabled: !!workItemId,
  });
};

export const useAddDependency = (workItemId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (blockedByWorkItemId: string) =>
      workItemsApi.addDependency(workItemId, blockedByWorkItemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dependencyKeys.byWorkItem(workItemId) });
      queryClient.invalidateQueries({ queryKey: workItemContextKeys.context(workItemId) });
      showToast.success("Dependencia agregada");
    },
    onError: () => {
      showToast.error("Error al agregar dependencia");
    },
  });
};

export const useRemoveDependency = (workItemId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (blockedByWorkItemId: string) =>
      workItemsApi.removeDependency(workItemId, blockedByWorkItemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dependencyKeys.byWorkItem(workItemId) });
      queryClient.invalidateQueries({ queryKey: workItemContextKeys.context(workItemId) });
      showToast.success("Dependencia eliminada");
    },
    onError: () => {
      showToast.error("Error al eliminar dependencia");
    },
  });
};
