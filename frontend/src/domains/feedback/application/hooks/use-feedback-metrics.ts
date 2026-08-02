import { useQuery } from "@tanstack/react-query";
import { feedbackMetricsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { FeedbackMetrics } from "../../domain/types";

export const feedbackMetricsKeys = {
  all: ["admin", "feedback", "metrics"] as const,
  get: (params?: { from?: string; to?: string }) =>
    [...feedbackMetricsKeys.all, params ?? {}] as const,
};

export const useFeedbackMetrics = (params?: { from?: string; to?: string }) => {
  const scopedKey = useOrgScopedKey(feedbackMetricsKeys.get(params));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => feedbackMetricsApi.get(params) as Promise<FeedbackMetrics>,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
  });
};
