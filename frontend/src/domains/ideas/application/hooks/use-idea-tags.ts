"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ideasApi } from "@/lib/api/client";
import { ideaMutationKeys } from "../../domain/query-keys";

export const useAddIdeaTag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { tagId?: string; name?: string; color?: string };
    }) => ideasApi.addTag(id, data),
    onSuccess: (_result, variables) => {
      for (const queryKey of ideaMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useRemoveIdeaTag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tagId }: { id: string; tagId: string }) =>
      ideasApi.removeTag(id, tagId),
    onSuccess: (_result, variables) => {
      for (const queryKey of ideaMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
