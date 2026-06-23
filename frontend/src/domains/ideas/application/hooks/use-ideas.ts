"use client";

import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { ideasApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  IdeaCommentVersion,
  IdeaItemEvent,
  IdeaItemStatus,
  IdeaItemTraceabilityResult,
  IdeaItemWithRelations,
  PaginatedIdeaItemsResponse,
} from "../../domain/types";

export const ideaKeys = {
  all: ["ideas"] as const,
  lists: () => [...ideaKeys.all, "list"] as const,
  list: (filters: string) => [...ideaKeys.lists(), filters] as const,
  details: () => [...ideaKeys.all, "detail"] as const,
  detail: (id: string) => [...ideaKeys.details(), id] as const,
  commentHistory: (ideaItemId: string, commentId: string) =>
    [...ideaKeys.all, "comment-history", ideaItemId, commentId] as const,
  traceability: () => [...ideaKeys.all, "traceability"] as const,
  traceabilityById: (id: string) => [...ideaKeys.traceability(), id] as const,
};

export const useIdeas = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(ideaKeys.list(params?.toString() ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => ideasApi.list(params) as Promise<IdeaItemWithRelations[]>,
    placeholderData: keepPreviousData,
  });
};

export const useIdeasWithPagination = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(ideaKeys.list(`paginated:${params?.toString() ?? ""}`));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<PaginatedIdeaItemsResponse> => {
      const result = await ideasApi.listWithMeta(params);
      return {
        items: result.data as IdeaItemWithRelations[],
        meta: result.meta,
      };
    },
    placeholderData: keepPreviousData,
  });
};

export const useIdeaItem = (id: string | null) => {
  const scopedKey = useOrgScopedKey(ideaKeys.detail(id ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => ideasApi.get(id!) as Promise<IdeaItemWithRelations>,
    enabled: !!id,
  });
};

export const useIdeaItemTraceability = (id: string | null) => {
  const scopedKey = useOrgScopedKey(ideaKeys.traceabilityById(id ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => ideasApi.getTraceability(id!) as Promise<IdeaItemTraceabilityResult>,
    enabled: !!id,
  });
};

export const useIdeaItemHistory = (id: string | null, params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(ideaKeys.list(`history:${id ?? ""}:${params?.toString() ?? ""}`));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<IdeaItemEvent[]> => {
      if (!id) return [];
      const result = await ideasApi.getHistory(id, params);
      return result.data as IdeaItemEvent[];
    },
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
};

export const useIdeaCommentHistory = (
  ideaItemId: string | null,
  commentId: string | null,
  enabled = true
) => {
  const scopedKey = useOrgScopedKey(ideaKeys.commentHistory(ideaItemId ?? "", commentId ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<IdeaCommentVersion[]> => {
      if (!ideaItemId || !commentId) return [];
      const versions = await ideasApi.getCommentHistory(ideaItemId, commentId);
      return versions as IdeaCommentVersion[];
    },
    enabled: enabled && !!ideaItemId && !!commentId,
    staleTime: 30_000,
  });
};

export const useDeleteIdeaItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ideasApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
    },
  });
};

export const useSetIdeaItemStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: IdeaItemStatus }) =>
      ideasApi.setStatus(id, status),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
      queryClient.invalidateQueries({ queryKey: ideaKeys.detail(variables.id) });
    },
  });
};

export const useAssignIdeaItemOwner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ownerUserId }: { id: string; ownerUserId: string | null }) =>
      ideasApi.setOwner(id, ownerUserId),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
      queryClient.invalidateQueries({ queryKey: ideaKeys.detail(variables.id) });
    },
  });
};

export const useSetIdeaItemDueDate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dueDate }: { id: string; dueDate: string | null }) =>
      ideasApi.setDueDate(id, dueDate),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
      queryClient.invalidateQueries({ queryKey: ideaKeys.detail(variables.id) });
    },
  });
};

export const useToggleDiscussed = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, discussed }: { id: string; discussed: boolean }) =>
      ideasApi.toggleDiscussed(id, discussed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
    },
  });
};
