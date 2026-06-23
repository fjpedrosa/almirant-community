import { useQueries, useQuery } from "@tanstack/react-query";
import { usageApi } from "@/lib/api/client";

type UsageSummary = Awaited<ReturnType<typeof usageApi.getSummary>>;

export interface UsageProjectSummaryProject {
  id: string;
  name: string;
}

export interface UsageProjectSummaryItem extends UsageProjectSummaryProject {
  totalSeconds: number;
  totalJobs: number;
  isLoading: boolean;
}

const usageKeys = {
  all: ["usage"] as const,
  summary: (projectId?: string) =>
    [...usageKeys.all, "summary", projectId ?? "all"] as const,
  history: (months?: number) =>
    [...usageKeys.all, "history", months ?? 6] as const,
};

export const useUsageSummary = (projectId?: string) => {
  return useQuery({
    queryKey: usageKeys.summary(projectId),
    queryFn: () => usageApi.getSummary(projectId),
    refetchInterval: 30_000,
  });
};

export const useUsageHistory = (months?: number) => {
  return useQuery({
    queryKey: usageKeys.history(months),
    queryFn: () => usageApi.getHistory(months),
    refetchInterval: 30_000,
  });
};

export const useUsageProjectSummaries = (
  projects: UsageProjectSummaryProject[]
) => {
  const queries = useQueries({
    queries: projects.map((project) => ({
      queryKey: usageKeys.summary(project.id),
      queryFn: () => usageApi.getSummary(project.id),
      enabled: !!project.id,
      refetchInterval: 30_000,
    })),
  });

  const items: UsageProjectSummaryItem[] = projects
    .map((project, index) => {
      const query = queries[index];
      const data = query?.data as UsageSummary | undefined;

      return {
        id: project.id,
        name: project.name,
        totalSeconds: data?.totalSeconds ?? 0,
        totalJobs: data?.totalJobs ?? 0,
        isLoading: query?.isLoading ?? false,
      };
    })
    .filter((item) => item.isLoading || item.totalSeconds > 0 || item.totalJobs > 0);

  const error = queries.find((query) => query.error)?.error ?? null;

  return {
    items,
    isLoading: queries.some((query) => query.isLoading),
    error,
  };
};
