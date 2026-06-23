import { useQuery } from "@tanstack/react-query";
import { usageApi } from "@/lib/api/client";

const userUsageKeys = {
  all: ["usage", "user"] as const,
  summary: () => [...userUsageKeys.all, "summary"] as const,
  history: (months?: number) =>
    [...userUsageKeys.all, "history", months ?? 12] as const,
};

export const useUserUsageSummary = () =>
  useQuery({
    queryKey: userUsageKeys.summary(),
    queryFn: () => usageApi.getUserSummary(),
    refetchInterval: 30_000,
  });

export const useUserUsageHistory = (months?: number) =>
  useQuery({
    queryKey: userUsageKeys.history(months),
    queryFn: () => usageApi.getUserHistory(months),
    refetchInterval: 30_000,
  });
