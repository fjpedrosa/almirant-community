"use client";

import { useQuery } from "@tanstack/react-query";
import { connectionsApi } from "@/lib/api/client";
import { connectionKeys } from "./use-connections";
import { calculatePacing } from "../../domain/pacing";
import type {
  UsageSummaryAccount,
  UsageSummaryResponseItem,
  UsageSummaryWindow,
  UsageSummaryWindowKey,
} from "../../domain/types";

const WINDOW_PERIOD_HOURS: Record<UsageSummaryWindowKey, number> = {
  fiveHour: 5,
  sevenDay: 7 * 24,
  sevenDayOpus: 7 * 24,
  sevenDaySonnet: 7 * 24,
};

const WINDOW_KEYS = Object.keys(
  WINDOW_PERIOD_HOURS,
) as UsageSummaryWindowKey[];

const getHoursUntilReset = (resetsAt: string): number => {
  const resetsAtMs = new Date(resetsAt).getTime();

  if (!Number.isFinite(resetsAtMs)) {
    return 0;
  }

  return Math.max(0, (resetsAtMs - Date.now()) / (60 * 60 * 1000));
};

const toUsageWindow = (
  key: UsageSummaryWindowKey,
  item: UsageSummaryResponseItem,
): UsageSummaryWindow | null => {
  const usageWindow = item.usage.oauthUsage?.[key];

  if (!usageWindow) {
    return null;
  }

  const periodHours = WINDOW_PERIOD_HOURS[key];

  return {
    key,
    utilization: usageWindow.utilization,
    resetsAt: usageWindow.resetsAt,
    periodHours,
    hoursUntilReset: getHoursUntilReset(usageWindow.resetsAt),
    pacing: calculatePacing(
      usageWindow.utilization,
      usageWindow.resetsAt,
      periodHours,
    ),
  };
};

const toUsageSummaryAccount = (
  item: UsageSummaryResponseItem,
): UsageSummaryAccount => {
  const windows = WINDOW_KEYS.flatMap((key) => {
    const window = toUsageWindow(key, item);
    return window ? [window] : [];
  });

  return {
    ...item,
    windows,
    hasAheadPacing: windows.some((window) => window.pacing.status === "ahead"),
  };
};

export const useUsageSummary = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true;

  const query = useQuery({
    queryKey: connectionKeys.usageSummary(),
    queryFn: async () => {
      try {
        return await connectionsApi.getUsageSummary();
      } catch {
        return [];
      }
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    select: (items) => {
      const accounts = items.map(toUsageSummaryAccount);

      return {
        accounts,
        // Historical naming from the task: this flag drives the red badge when
        // an account is actually over pace ("ahead"), not under pace.
        hasAccountBehind: accounts.some((account) => account.hasAheadPacing),
      };
    },
  });

  return {
    accounts: query.data?.accounts ?? [],
    isLoading: query.isLoading,
    isRefreshing: query.isFetching && !query.isLoading,
    hasAccountBehind: query.data?.hasAccountBehind ?? false,
    dataUpdatedAt: query.dataUpdatedAt,
  };
};
