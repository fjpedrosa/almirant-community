"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tagsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { TagWithCount, CreateTagRequest, UpdateTagRequest } from "../../domain/types";

// Query keys
export const tagKeys = {
  all: ["tags"] as const,
  lists: () => [...tagKeys.all, "list"] as const,
};

// Get tags list with count
export const useTags = () => {
  const scopedKey = useOrgScopedKey(tagKeys.lists());
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => tagsApi.list() as Promise<TagWithCount[]>,
  });
};

// Create tag
export const useCreateTag = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTagRequest) => tagsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.lists() });
    },
  });
};

// Update tag
export const useUpdateTag = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTagRequest }) =>
      tagsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.lists() });
    },
  });
};

// Delete tag
export const useDeleteTag = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => tagsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.lists() });
    },
  });
};
