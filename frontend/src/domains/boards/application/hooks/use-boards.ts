"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { boardsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  BoardWithStats,
  BoardTemplate,
  CreateBoardRequest,
  UpdateBoardRequest,
  CreateBoardFromTemplateRequest,
} from "../../domain/types";

export const boardKeys = {
  all: ["boards"] as const,
  lists: () => [...boardKeys.all, "list"] as const,
  listAll: () => [...boardKeys.lists(), "all"] as const,
  listByArea: (area: string) => [...boardKeys.lists(), "area", area] as const,
  details: () => [...boardKeys.all, "detail"] as const,
  detail: (id: string) => [...boardKeys.details(), id] as const,
  templates: () => [...boardKeys.all, "templates"] as const,
};

export const useAllBoards = () => {
  const scopedKey = useOrgScopedKey(boardKeys.listAll());
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => boardsApi.listAll() as Promise<BoardWithStats[]>,
  });
};

export const useBoardsByArea = (area: string) => {
  const scopedKey = useOrgScopedKey(boardKeys.listByArea(area));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => boardsApi.listByArea(area) as Promise<BoardWithStats[]>,
    enabled: !!area,
  });
};

export const useBoard = (id: string) => {
  const scopedKey = useOrgScopedKey(boardKeys.detail(id));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => boardsApi.get(id) as Promise<BoardWithStats>,
    enabled: !!id,
  });
};

export const useBoardTemplates = () => {
  const scopedKey = useOrgScopedKey(boardKeys.templates());
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => boardsApi.getTemplates() as Promise<BoardTemplate[]>,
  });
};

export const useCreateBoard = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateBoardRequest) =>
      boardsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
};

export const useUpdateBoard = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBoardRequest }) =>
      boardsApi.update(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(variables.id) });
    },
  });
};

export const useDeleteBoard = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => boardsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
};

export const useCreateBoardFromTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateBoardFromTemplateRequest) =>
      boardsApi.createFromTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
};
