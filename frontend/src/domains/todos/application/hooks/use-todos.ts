"use client";

import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { todosApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { todoKeys, todoMutationKeys } from "../../domain/query-keys";
import type {
  TodoCommentVersion,
  TodoItemEvent,
  TodoItemStatus,
  TodoItemPriority,
  TodoItemWithRelations,
  PaginatedTodoItemsResponse,
  UpdateTodoItemRequest,
} from "../../domain/types";

// Re-exported so existing imports (`from "./use-todos"`) keep working.
export { todoKeys, todoMutationKeys };

export const useTodos = (params?: URLSearchParams) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(todoKeys.list(params?.toString() ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => todosApi.list(params) as Promise<TodoItemWithRelations[]>,
    placeholderData: keepPreviousData,
    enabled: !!confirmedActiveTeamId,
  });
};

export const useTodosWithPagination = (params?: URLSearchParams) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(todoKeys.list(`paginated:${params?.toString() ?? ""}`));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<PaginatedTodoItemsResponse> => {
      const result = await todosApi.listWithMeta(params);
      return {
        items: result.data as TodoItemWithRelations[],
        meta: result.meta,
      };
    },
    placeholderData: keepPreviousData,
    enabled: !!confirmedActiveTeamId,
  });
};

export const useTodoItem = (id: string | null) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(todoKeys.detail(id ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => todosApi.get(id!) as Promise<TodoItemWithRelations>,
    enabled: !!id && !!confirmedActiveTeamId,
  });
};

export const useTodoItemHistory = (id: string | null, params?: URLSearchParams) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(todoKeys.list(`history:${id ?? ""}:${params?.toString() ?? ""}`));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<TodoItemEvent[]> => {
      if (!id) return [];
      const result = await todosApi.getHistory(id, params);
      return result.data as TodoItemEvent[];
    },
    enabled: !!id && !!confirmedActiveTeamId,
    placeholderData: keepPreviousData,
  });
};

export const useTodoCommentHistory = (
  todoId: string | null,
  commentId: string | null,
  enabled = true
) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(todoKeys.commentHistory(todoId ?? "", commentId ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<TodoCommentVersion[]> => {
      if (!todoId || !commentId) return [];
      const versions = await todosApi.getCommentHistory(todoId, commentId);
      return versions as TodoCommentVersion[];
    },
    enabled: enabled && !!todoId && !!commentId && !!confirmedActiveTeamId,
    staleTime: 30_000,
  });
};

export const useCreateTodo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) => todosApi.create(data),
    onSuccess: () => {
      for (const queryKey of todoMutationKeys()) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useUpdateTodo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTodoItemRequest }) =>
      todosApi.update(id, data),
    onSuccess: (_result, variables) => {
      for (const queryKey of todoMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useDeleteTodo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => todosApi.delete(id),
    onSuccess: (_result, id) => {
      for (const queryKey of todoMutationKeys(id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useSetTodoStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TodoItemStatus }) =>
      todosApi.setStatus(id, status),
    onSuccess: (_result, variables) => {
      for (const queryKey of todoMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useAssignTodoOwner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ownerUserId }: { id: string; ownerUserId: string | null }) =>
      todosApi.setOwner(id, ownerUserId),
    onSuccess: (_result, variables) => {
      for (const queryKey of todoMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useSetTodoDueDate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dueDate }: { id: string; dueDate: string | null }) =>
      todosApi.setDueDate(id, dueDate),
    onSuccess: (_result, variables) => {
      for (const queryKey of todoMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useSetTodoPriority = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: TodoItemPriority | null }) =>
      todosApi.update(id, { priority }),
    onSuccess: (_result, variables) => {
      for (const queryKey of todoMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
