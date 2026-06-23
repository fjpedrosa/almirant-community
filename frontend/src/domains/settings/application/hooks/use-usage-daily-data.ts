import { useQuery } from "@tanstack/react-query";
import { usageApi } from "@/lib/api/client";

const usageDailyKeys = {
  daily: (days: number, sessionType?: string) =>
    ["usage", "daily", days, sessionType] as const,
  hourly: (days: number, sessionType?: string) =>
    ["usage", "hourly", days, sessionType] as const,
};

export interface UsageHourlyPoint {
  hour: number;
  label: string;
  totalSeconds: number;
  totalJobs: number;
}

export const useUsageDailyHistory = (
  days: number,
  sessionType?: string
) => {
  return useQuery({
    queryKey: usageDailyKeys.daily(days, sessionType),
    queryFn: () => usageApi.getDaily(days, sessionType),
    refetchInterval: 30_000,
  });
};


export const useUsageHourlyDistribution = (
  days: number,
  sessionType?: string
) => {
  return useQuery({
    queryKey: usageDailyKeys.hourly(days, sessionType),
    queryFn: () => usageApi.getHourly(days, sessionType),
    refetchInterval: 30_000,
  });
};
