"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { boardsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  CreateColumnRequest,
  UpdateColumnRequest,
} from "../../domain/types";
import type { BoardColumn } from "../../domain/types";
import { boardKeys } from "./use-boards";

export const columnKeys = {
  all: ["board-columns"] as const,
  list: (boardId: string) => [...columnKeys.all, boardId] as const,
};

export const useBoardColumns = (boardId: string) => {
  const scopedKey = useOrgScopedKey(columnKeys.list(boardId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => boardsApi.listColumns(boardId) as Promise<BoardColumn[]>,
    enabled: !!boardId,
  });
};

export const useCreateColumn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, data }: { boardId: string; data: CreateColumnRequest }) =>
      boardsApi.createColumn(boardId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: columnKeys.list(variables.boardId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(variables.boardId) });
    },
  });
};

export const useUpdateColumn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, colId, data }: { boardId: string; colId: string; data: UpdateColumnRequest }) =>
      boardsApi.updateColumn(boardId, colId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: columnKeys.list(variables.boardId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(variables.boardId) });
    },
  });
};

export const useDeleteColumn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, colId }: { boardId: string; colId: string }) =>
      boardsApi.deleteColumn(boardId, colId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: columnKeys.list(variables.boardId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(variables.boardId) });
    },
  });
};

export const useReorderColumns = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, columnIds }: { boardId: string; columnIds: string[] }) =>
      boardsApi.reorderColumns(boardId, columnIds),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: columnKeys.list(variables.boardId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(variables.boardId) });
    },
  });
};
