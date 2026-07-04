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

// Usage totals are slow-moving aggregates; a 5min refresh is plenty and drops
// the previous 30s treadmill by 10x.
const USAGE_REFETCH_MS = 5 * 60_000;

export const useUsageSummary = (projectId?: string) => {
  return useQuery({
    queryKey: usageKeys.summary(projectId),
    queryFn: () => usageApi.getSummary(projectId),
    refetchInterval: USAGE_REFETCH_MS,
    staleTime: USAGE_REFETCH_MS,
  });
};

export const useUsageHistory = (months?: number) => {
  return useQuery({
    queryKey: usageKeys.history(months),
    queryFn: () => usageApi.getHistory(months),
    refetchInterval: USAGE_REFETCH_MS,
    staleTime: USAGE_REFETCH_MS,
  });
};

export const useUsageProjectSummaries = (
  projects: UsageProjectSummaryProject[]
) => {
  // No interval here: this fans out one request PER project every tick — the
  // worst offender. Fetch once and lean on staleTime; the page-level summary
  // already refreshes on its own cadence.
  const queries = useQueries({
    queries: projects.map((project) => ({
      queryKey: usageKeys.summary(project.id),
      queryFn: () => usageApi.getSummary(project.id),
      enabled: !!project.id,
      staleTime: USAGE_REFETCH_MS,
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
