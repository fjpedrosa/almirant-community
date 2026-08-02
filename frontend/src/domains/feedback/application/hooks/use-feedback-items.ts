"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { adminFeedbackApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { feedbackKeys } from "./use-feedback-traceability";
import type {
  FeedbackItem,
  FeedbackStatus,
  PaginatedFeedbackResponse,
} from "../../domain/types";

export const useFeedbackItems = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(feedbackKeys.itemList(params?.toString() || ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<PaginatedFeedbackResponse> => {
      const result = await adminFeedbackApi.getFeedbackItems(params);
      return {
        items: result.data as FeedbackItem[],
        meta: result.meta,
      };
    },
    placeholderData: keepPreviousData,
  });
};

export const useUpdateFeedbackStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: FeedbackStatus }) =>
      adminFeedbackApi.updateFeedbackItem(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.items() });
    },
  });
};

export const useDeleteFeedbackItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adminFeedbackApi.deleteFeedbackItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.items() });
    },
  });
};

export const useTriageFeedbackItem = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adminFeedbackApi.triageFeedbackItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.items() });
    },
  });
};
