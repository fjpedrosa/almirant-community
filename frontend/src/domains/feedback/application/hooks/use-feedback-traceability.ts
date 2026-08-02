import { useQuery } from "@tanstack/react-query";
import { adminFeedbackApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { FeedbackTraceabilityResult } from "../../domain/types";

export const feedbackKeys = {
  all: ["backoffice", "feedback"] as const,
  items: () => [...feedbackKeys.all, "items"] as const,
  itemList: (filters: string) => [...feedbackKeys.items(), "list", filters] as const,
  item: (id: string) => [...feedbackKeys.items(), id] as const,
  sources: () => [...feedbackKeys.all, "sources"] as const,
  traceability: (feedbackItemId: string) => [...feedbackKeys.all, "traceability", feedbackItemId] as const,
  promotions: () => [...feedbackKeys.all, "promotions"] as const,
  promotionByWorkItem: (workItemId: string) => [...feedbackKeys.promotions(), "work-item", workItemId] as const,
  comments: (feedbackItemId: string) => [...feedbackKeys.all, "comments", feedbackItemId] as const,
  mentionMembers: () => [...feedbackKeys.all, "mention-members"] as const,
};

export const useFeedbackTraceability = (feedbackItemId: string | null) => {
  const scopedKey = useOrgScopedKey(feedbackKeys.traceability(feedbackItemId ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => adminFeedbackApi.getFeedbackTraceability(feedbackItemId!) as Promise<FeedbackTraceabilityResult>,
    enabled: !!feedbackItemId,
  });
};

export const useFeedbackPromotionByWorkItem = (workItemId: string | null) => {
  const scopedKey = useOrgScopedKey(feedbackKeys.promotionByWorkItem(workItemId ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async () => {
      const params = new URLSearchParams({ workItemId: workItemId! });
      const promotions = await adminFeedbackApi.getFeedbackPromotions(params) as Array<{
        feedbackItemId: string;
        feedbackItem?: { id: string; title: string; status: string } | null;
      }>;
      return promotions[0] ?? null;
    },
    enabled: !!workItemId,
  });
};
