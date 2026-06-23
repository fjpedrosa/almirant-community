"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { workItemContextKeys } from "./use-work-item-context";

export const useLinkCommit = (workItemId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commitId: string) =>
      workItemsApi.linkCommit(workItemId, commitId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workItemContextKeys.context(workItemId),
      });
      showToast.success("Commit vinculado");
    },
    onError: () => {
      showToast.error("Error al vincular commit");
    },
  });
};

export const useUnlinkCommit = (workItemId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commitId: string) =>
      workItemsApi.unlinkCommit(workItemId, commitId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workItemContextKeys.context(workItemId),
      });
      showToast.success("Commit desvinculado");
    },
    onError: () => {
      showToast.error("Error al desvincular commit");
    },
  });
};
