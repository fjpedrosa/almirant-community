"use client";

import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { connectionsApi } from "@/lib/api/client";
import { connectionKeys } from "./use-connections";
import type { ProviderType } from "../../domain/types";

// ---------------------------------------------------------------------------
// AI provider check
// ---------------------------------------------------------------------------

const AI_PROVIDERS: ProviderType[] = ["openai", "anthropic", "google", "zai", "xai"];

const isAiProvider = (provider: string): boolean =>
  AI_PROVIDERS.includes(provider as ProviderType);

// ---------------------------------------------------------------------------
// useUsageAccountRefresh - lean hook for per-account manual refresh
// ---------------------------------------------------------------------------

/**
 * Hook for manually refreshing usage data for a single account in the usage drawer.
 * Unlike `useConnectionUsage`, this does NOT fire a query on mount - it only
 * triggers a refresh when explicitly called, avoiding N redundant queries.
 *
 * On refresh:
 * 1. Calls `connectionsApi.getUsage(connectionId, { forceRefresh: true })` to prime server cache
 * 2. Invalidates `connectionKeys.usageSummary()` so the summary query refetches with fresh data
 *
 * @param connectionId - The connection ID to refresh
 * @param provider - The provider type (only AI providers support usage)
 * @param initialDataUpdatedAt - Initial timestamp from the parent summary query
 */
export const useUsageAccountRefresh = (
  connectionId: string,
  provider: string,
  initialDataUpdatedAt: number | undefined,
) => {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<number | undefined>(
    initialDataUpdatedAt,
  );

  // Sync with parent query's dataUpdatedAt when it changes
  useEffect(() => {
    if (initialDataUpdatedAt !== undefined) {
      setDataUpdatedAt(initialDataUpdatedAt);
    }
  }, [initialDataUpdatedAt]);

  const refreshUsage = useCallback(async () => {
    if (!connectionId || !isAiProvider(provider)) {
      return;
    }

    setIsRefreshing(true);

    try {
      // Prime the server cache with fresh data
      await connectionsApi.getUsage(connectionId, { forceRefresh: true });

      // Update local timestamp
      setDataUpdatedAt(Date.now());

      // Invalidate summary query so drawer picks up fresh data
      await queryClient.invalidateQueries({
        queryKey: connectionKeys.usageSummary(),
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [connectionId, provider, queryClient]);

  return {
    refreshUsage,
    isRefreshing,
    dataUpdatedAt,
  };
};
