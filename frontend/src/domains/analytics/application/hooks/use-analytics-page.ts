"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { agentJobsApi, analyticsApi } from "@/lib/api/client";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";

export const analyticsKeys = {
  all: ["analytics"] as const,
  overview: () => [...analyticsKeys.all, "overview"] as const,
  trends: (months: number) => [...analyticsKeys.all, "trends", months] as const,
  users: (period?: string) =>
    [...analyticsKeys.all, "users", period ?? "current"] as const,
  systemMonitoring: (range: "1h" | "6h" | "24h") =>
    [...analyticsKeys.all, "system-monitoring", range] as const,
};

export const useAnalyticsPage = () => {
  const queryClient = useQueryClient();
  const t = useTranslations("analytics");

  const overviewQuery = useQuery({
    queryKey: analyticsKeys.overview(),
    queryFn: analyticsApi.getOverview,
    refetchInterval: 30_000,
  });

  const trendsQuery = useQuery({
    queryKey: analyticsKeys.trends(12),
    queryFn: () => analyticsApi.getTrends(12),
    refetchInterval: 30_000,
  });

  const usersQuery = useQuery({
    queryKey: analyticsKeys.users(),
    queryFn: () => analyticsApi.getUsers(),
    refetchInterval: 30_000,
  });

  const systemMonitoringQuery = useQuery({
    queryKey: analyticsKeys.systemMonitoring("1h"),
    queryFn: () => analyticsApi.getSystemMonitoring("1h"),
    refetchInterval: 10_000,
  });

  const usageError =
    overviewQuery.error || trendsQuery.error || usersQuery.error;
  const hasUsageData =
    overviewQuery.data != null ||
    (trendsQuery.data?.length ?? 0) > 0 ||
    (usersQuery.data?.length ?? 0) > 0;
  const systemMonitoringError =
    systemMonitoringQuery.error && !systemMonitoringQuery.data
      ? systemMonitoringQuery.error
      : null;

  const cancelJobMutation = useMutation({
    mutationFn: (jobId: string) => agentJobsApi.cancel(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
      showToast.success(t("system.cancelSuccess"));
    },
    onError: (err) => {
      showToast.error(
        err instanceof Error ? err.message : t("system.cancelError"),
      );
    },
  });

  return {
    overview: overviewQuery.data,
    trends: trendsQuery.data ?? [],
    users: usersQuery.data ?? [],
    systemMonitoring: systemMonitoringQuery.data,
    isLoading:
      overviewQuery.isLoading || trendsQuery.isLoading || usersQuery.isLoading,
    isSystemMonitoringLoading: systemMonitoringQuery.isLoading,
    error: usageError && !hasUsageData ? usageError : null,
    systemMonitoringError,
    cancelJob: cancelJobMutation.mutate,
    isCancellingJob: cancelJobMutation.isPending,
  };
};
