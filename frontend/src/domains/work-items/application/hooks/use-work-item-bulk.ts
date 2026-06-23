"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import type { Priority } from "../../domain/types";
import { workItemKeys } from "./use-work-items";

export const useBulkMove = (boardId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workItemIds, boardColumnId }: { workItemIds: string[]; boardColumnId: string }) =>
      workItemsApi.bulkMove(workItemIds, boardColumnId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.byBoard(boardId) });
      queryClient.invalidateQueries({ queryKey: workItemKeys.byAreaPrefix() });
    },
  });
};

export const useBulkChangePriority = (boardId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workItemIds, priority }: { workItemIds: string[]; priority: Priority }) =>
      workItemsApi.bulkPriority(workItemIds, priority),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.byBoard(boardId) });
      queryClient.invalidateQueries({ queryKey: workItemKeys.byAreaPrefix() });
    },
  });
};
