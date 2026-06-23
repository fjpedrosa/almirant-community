"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ideasApi } from "@/lib/api/client";
import { ideaKeys } from "./use-ideas";

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
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
      queryClient.invalidateQueries({ queryKey: ideaKeys.detail(variables.id) });
    },
  });
};

export const useRemoveIdeaTag = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tagId }: { id: string; tagId: string }) =>
      ideasApi.removeTag(id, tagId),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
      queryClient.invalidateQueries({ queryKey: ideaKeys.detail(variables.id) });
    },
  });
};
