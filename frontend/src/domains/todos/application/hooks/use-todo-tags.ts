"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { todosApi } from "@/lib/api/client";
import { tagKeys } from "@/domains/tags/application/hooks/use-tags";
import { todoMutationKeys } from "../../domain/query-keys";

export const useAddTodoTag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { tagId?: string; name?: string; color?: string };
    }) => todosApi.addTag(id, data),
    onSuccess: (_result, variables) => {
      for (const queryKey of todoMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
      queryClient.invalidateQueries({ queryKey: tagKeys.lists() });
    },
  });
};

export const useRemoveTodoTag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tagId }: { id: string; tagId: string }) =>
      todosApi.removeTag(id, tagId),
    onSuccess: (_result, variables) => {
      for (const queryKey of todoMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
