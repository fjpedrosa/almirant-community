"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { seedsApi } from "@/lib/api/client";
import type { SeedStatus, SeedWithRelations, SeedComment, SeedEvent } from "../../domain/types";

export const seedDetailKeys = {
  detail: (id: string) => ["seeds", id, "detail"] as const,
  comments: (id: string) => ["seeds", id, "comments"] as const,
  history: (id: string) => ["seeds", id, "history"] as const,
};

export const useSeedDetail = (seedId: string | null) => {
  const queryClient = useQueryClient();

  // Fetch seed detail
  const seedQuery = useQuery({
    queryKey: seedDetailKeys.detail(seedId ?? ""),
    queryFn: () => seedsApi.get(seedId!) as Promise<SeedWithRelations>,
    enabled: !!seedId,
  });

  // Fetch comments
  const commentsQuery = useQuery({
    queryKey: seedDetailKeys.comments(seedId ?? ""),
    queryFn: () => seedsApi.listComments(seedId!) as Promise<SeedComment[]>,
    enabled: !!seedId,
  });

  // Fetch history
  const historyQuery = useQuery({
    queryKey: seedDetailKeys.history(seedId ?? ""),
    queryFn: async () => {
      const result = await seedsApi.getHistory(seedId!);
      return result.data as SeedEvent[];
    },
    enabled: !!seedId,
  });

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: (status: SeedStatus) => seedsApi.setStatus(seedId!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seedDetailKeys.detail(seedId!) });
      queryClient.invalidateQueries({ queryKey: ["seeds"] }); // Refresh list
    },
  });

  // Update owner mutation
  const updateOwnerMutation = useMutation({
    mutationFn: (ownerUserId: string | null) => seedsApi.setOwner(seedId!, ownerUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seedDetailKeys.detail(seedId!) });
      queryClient.invalidateQueries({ queryKey: ["seeds"] }); // Refresh list
    },
  });

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: (content: string) => seedsApi.addComment(seedId!, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seedDetailKeys.comments(seedId!) });
      queryClient.invalidateQueries({ queryKey: ["seeds"] }); // Refresh list for comment count
    },
  });

  return {
    seed: seedQuery.data ?? null,
    isLoading: seedQuery.isLoading,
    comments: commentsQuery.data ?? [],
    isLoadingComments: commentsQuery.isLoading,
    history: historyQuery.data ?? [],
    isLoadingHistory: historyQuery.isLoading,
    updateStatus: updateStatusMutation.mutate,
    isUpdatingStatus: updateStatusMutation.isPending,
    updateOwner: updateOwnerMutation.mutate,
    isUpdatingOwner: updateOwnerMutation.isPending,
    addComment: addCommentMutation.mutate,
    isAddingComment: addCommentMutation.isPending,
  };
};
