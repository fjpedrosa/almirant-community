"use client";

import { useQuery } from "@tanstack/react-query";
import { connectionsApi } from "@/lib/api/client";
import { connectionKeys } from "./use-connections";
import { useUsageAccountRefresh } from "./use-usage-account-refresh";
import { selectConnectionUsage } from "../../domain/usage-selectors";
import type {
  ConnectionUsageData,
  ProviderType,
  UsageSummaryResponseItem,
} from "../../domain/types";

const AI_PROVIDERS: ProviderType[] = [
  "openai",
  "anthropic",
  "google",
  "zai",
  "xai",
];

const isAiProvider = (provider: ProviderType): boolean =>
  AI_PROVIDERS.includes(provider);

/**
 * Per-connection usage served from the ALREADY-batched usage summary
 * (`GET /connections/usage-summary`) instead of one `GET /connections/:id/usage`
 * per row.
 *
 * Every row subscribes to the SAME summary query key, so React Query dedupes
 * them into a single network request + a single 5-minute poll, then each row
 * `select`s its own connection out of the result. Manual refresh reuses the
 * lean `useUsageAccountRefresh` (force-refresh + summary invalidation).
 */
export const useConnectionUsageFromSummary = (
  connectionId: string | null,
  provider: ProviderType,
) => {
  const enabled = !!connectionId && isAiProvider(provider);

  const query = useQuery({
    queryKey: connectionKeys.usageSummary(),
    queryFn: async (): Promise<UsageSummaryResponseItem[]> => {
      try {
        return await connectionsApi.getUsageSummary();
      } catch {
        return [];
      }
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    select: (items): ConnectionUsageData | null =>
      selectConnectionUsage(items, connectionId ?? ""),
  });

  const { refreshUsage, isRefreshing } = useUsageAccountRefresh(
    connectionId ?? "",
    provider,
    query.dataUpdatedAt,
  );

  return {
    usage: query.data ?? null,
    isLoading: query.isLoading && enabled,
    isRefreshing: isRefreshing || (query.isFetching && !query.isLoading),
    refreshUsage,
    dataUpdatedAt: query.dataUpdatedAt,
  };
};
