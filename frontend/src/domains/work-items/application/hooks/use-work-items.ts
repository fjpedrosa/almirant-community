"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  WorkItemWithRelations,
  WorkItemsByColumn,
  CreateWorkItemRequest,
  UpdateWorkItemRequest,
  PaginatedWorkItemsResponse,
} from "../../domain/types";

export const workItemKeys = {
  all: ["work-items"] as const,
  lists: () => [...workItemKeys.all, "list"] as const,
  list: (filters: string) => [...workItemKeys.lists(), filters] as const,
  details: () => [...workItemKeys.all, "detail"] as const,
  detail: (id: string) => [...workItemKeys.details(), id] as const,
  byBoard: (boardId: string) => [...workItemKeys.all, "board", boardId] as const,
  byArea: (area: string) => [...workItemKeys.all, "byArea", area] as const,
  byAreaPrefix: () => [...workItemKeys.all, "byArea"] as const,
  participants: (idsHash: string) => [...workItemKeys.all, "participants", idsHash] as const,
};

export const useWorkItems = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(workItemKeys.list(params?.toString() || ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => workItemsApi.list(params) as Promise<WorkItemWithRelations[]>,
    placeholderData: keepPreviousData,
  });
};

export const useWorkItemsWithPagination = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(workItemKeys.list(params?.toString() || "paginated"));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<PaginatedWorkItemsResponse> => {
      const result = await workItemsApi.listWithMeta(params);
      return {
        items: result.data as WorkItemWithRelations[],
        meta: result.meta,
      };
    },
    placeholderData: keepPreviousData,
  });
};

export const useWorkItem = (id: string) => {
  const scopedKey = useOrgScopedKey(workItemKeys.detail(id));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => workItemsApi.get(id) as Promise<WorkItemWithRelations>,
    enabled: !!id,
  });
};

export const useCreateWorkItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWorkItemRequest) => workItemsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });
};

export const useUpdateWorkItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWorkItemRequest }) =>
      workItemsApi.update(id, data),
    onMutate: async ({ id, data }) => {
      // Only cancel queries we're about to optimistically update
      await queryClient.cancelQueries({ queryKey: [...workItemKeys.all, "board"] });
      await queryClient.cancelQueries({ queryKey: workItemKeys.detail(id) });

      // Snapshot board caches
      const boardCaches = queryClient.getQueriesData<WorkItemsByColumn[]>({
        queryKey: [...workItemKeys.all, "board"],
      });

      // Snapshot detail cache
      const detailSnapshot = queryClient.getQueryData<WorkItemWithRelations>(
        workItemKeys.detail(id)
      );

      // Optimistic update on board caches
      for (const [key, boardData] of boardCaches) {
        if (!boardData) continue;
        queryClient.setQueryData<WorkItemsByColumn[]>(key, (old) => {
          if (!old) return old;
          return old.map((col) => ({
            ...col,
            items: col.items.map((item) => {
              if (item.id !== id) return item;
              return {
                ...item,
                ...(data.title !== undefined && { title: data.title }),
                ...(data.type !== undefined && { type: data.type }),
                ...(data.priority !== undefined && { priority: data.priority }),
                ...(data.assignee !== undefined && { assignee: data.assignee }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.metadata !== undefined && { metadata: { ...item.metadata, ...data.metadata } }),
              };
            }),
          }));
        });
      }

      // Optimistic update on detail cache
      if (detailSnapshot) {
        queryClient.setQueryData<WorkItemWithRelations>(
          workItemKeys.detail(id),
          (old) => {
            if (!old) return old;
            return {
              ...old,
              ...(data.title !== undefined && { title: data.title }),
              ...(data.type !== undefined && { type: data.type }),
              ...(data.priority !== undefined && { priority: data.priority }),
              ...(data.assignee !== undefined && { assignee: data.assignee }),
              ...(data.description !== undefined && { description: data.description }),
              ...(data.dueDate !== undefined && { dueDate: data.dueDate ? new Date(data.dueDate) : null }),
              ...(data.estimatedHours !== undefined && { estimatedHours: data.estimatedHours }),
              ...(data.parentId !== undefined && { parentId: data.parentId }),
              ...(data.projectId !== undefined && { projectId: data.projectId }),
              ...(data.metadata !== undefined && { metadata: { ...old.metadata, ...data.metadata } }),
            };
          }
        );
      }

      return { boardCaches, detailSnapshot };
    },
    onError: (_err, variables, context) => {
      // Rollback board caches
      if (context?.boardCaches) {
        for (const [key, data] of context.boardCaches) {
          queryClient.setQueryData(key, data);
        }
      }
      // Rollback detail cache
      if (context?.detailSnapshot) {
        queryClient.setQueryData(
          workItemKeys.detail(variables.id),
          context.detailSnapshot
        );
      }
      showToast.error("Error al actualizar item");
    },
    onSettled: (_data, _error, variables) => {
      // Explicitly invalidate all related query types
      queryClient.invalidateQueries({ queryKey: workItemKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: workItemKeys.lists() });
      queryClient.invalidateQueries({ queryKey: [...workItemKeys.all, "board"] });
      queryClient.invalidateQueries({ queryKey: workItemKeys.byAreaPrefix() });
    },
  });
};

export const useDeleteWorkItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workItemsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });
};

export const useResetAiProcessing = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workItemsApi.resetAi(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });
};
