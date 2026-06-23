"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { connectionsApi } from "@/lib/api/client";
import { connectionKeys } from "./use-connections";
import type { ConnectionUsageData, ProviderType } from "../../domain/types";

// ---------------------------------------------------------------------------
// AI provider check
// ---------------------------------------------------------------------------

const AI_PROVIDERS: ProviderType[] = [
  "openai",
  "anthropic",
  "google",
  "zai",
  "xai",
];

const isAiProvider = (provider: ProviderType): boolean =>
  AI_PROVIDERS.includes(provider);

// ---------------------------------------------------------------------------
// useConnectionUsage - fetches usage data for a single AI connection
// ---------------------------------------------------------------------------

export const useConnectionUsage = (
  connectionId: string | null,
  provider: ProviderType,
) => {
  const queryClient = useQueryClient();
  const loadUsage = useCallback(
    (forceRefresh = false) =>
      connectionsApi.getUsage(connectionId!, {
        forceRefresh,
      }) as Promise<ConnectionUsageData>,
    [connectionId],
  );

  const query = useQuery({
    queryKey: [...connectionKeys.detail(connectionId ?? ""), "usage"] as const,
    queryFn: () => loadUsage(false),
    enabled: !!connectionId && isAiProvider(provider),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const refreshUsage = useCallback(async () => {
    if (!connectionId || !isAiProvider(provider)) {
      return null;
    }

    return queryClient.fetchQuery({
      queryKey: [...connectionKeys.detail(connectionId), "usage"] as const,
      queryFn: () => loadUsage(true),
      staleTime: 0,
    });
  }, [connectionId, provider, queryClient, loadUsage]);

  return {
    usage: query.data ?? null,
    isLoading: query.isLoading,
    isRefreshing: query.isFetching && !query.isLoading,
    refreshUsage,
    dataUpdatedAt: query.dataUpdatedAt,
  };
};
