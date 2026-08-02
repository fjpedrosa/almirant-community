"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ClustersFiltersState } from "../../presentation/components/clusters-filter-bar";
import {
  ACTIVE_CLUSTER_STATUSES,
  type ClusterRow,
  type ClusterStatus,
} from "../../domain/types";
import { useClustersByTopicQuery } from "./use-clusters-by-topic";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FILTERS: ClustersFiltersState = {
  statuses: [...ACTIVE_CLUSTER_STATUSES],
  showResolved: false,
  minItemCount: 1,
  sortBy: "itemCount",
};

const VALID_STATUSES: ClusterStatus[] = [
  "open",
  "investigating",
  "fix_ready",
  "resolved",
  "regression",
  "dismissed",
  "promoted",
];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * URL-synced filter + query hook for the clusters data-table.
 *
 * Reads filter state from the URL, exposes strongly-typed update handlers that
 * write changes back via `router.push`, builds the API query params, wraps the
 * clusters query, and flattens the grouped response into a flat `ClusterRow[]`
 * (each cluster decorated with its `topicTitle`).
 *
 * Extracted from `ClustersContainer` as part of A-1886.
 */
export function useClustersTable(): {
  filters: ClustersFiltersState;
  updateFilters: (updates: Partial<ClustersFiltersState>) => void;
  handleStatusesChange: (statuses: ClusterStatus[]) => void;
  handleShowResolvedChange: (showResolved: boolean) => void;
  handleMinItemCountChange: (count: number) => void;
  handleSortChange: (sortBy: "itemCount" | "createdAt") => void;
  handleClearFilters: () => void;
  apiParams: URLSearchParams;
  clustersQuery: ReturnType<typeof useClustersByTopicQuery>;
  rows: ClusterRow[];
} {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // -------------------------------------------------------------------------
  // Filters state (URL-synced)
  // -------------------------------------------------------------------------

  const filters = useMemo((): ClustersFiltersState => {
    const statusesParam = searchParams.get("statuses");
    const showResolved = searchParams.get("showResolved") === "true";
    const minItemCount = searchParams.get("minItemCount");
    const sortBy = searchParams.get("sortBy") as "itemCount" | "createdAt" | null;

    let statuses: ClusterStatus[];
    if (statusesParam) {
      statuses = statusesParam
        .split(",")
        .filter((s): s is ClusterStatus => VALID_STATUSES.includes(s as ClusterStatus));
      if (statuses.length === 0) {
        statuses = [...ACTIVE_CLUSTER_STATUSES];
      }
    } else {
      statuses = [...ACTIVE_CLUSTER_STATUSES];
    }

    return {
      statuses,
      showResolved,
      minItemCount: minItemCount ? Number(minItemCount) : DEFAULT_FILTERS.minItemCount,
      sortBy:
        sortBy && ["itemCount", "createdAt"].includes(sortBy)
          ? sortBy
          : DEFAULT_FILTERS.sortBy,
    };
  }, [searchParams]);

  const updateFilters = useCallback(
    (updates: Partial<ClustersFiltersState>) => {
      const params = new URLSearchParams(searchParams.toString());
      const newFilters = { ...filters, ...updates };

      // Update statuses param
      const defaultStatusesSet = new Set(ACTIVE_CLUSTER_STATUSES);
      const statusesMatchDefault =
        newFilters.statuses.length === ACTIVE_CLUSTER_STATUSES.length &&
        newFilters.statuses.every((s) => defaultStatusesSet.has(s));

      if (!statusesMatchDefault) {
        params.set("statuses", newFilters.statuses.join(","));
      } else {
        params.delete("statuses");
      }

      // Update showResolved param
      if (newFilters.showResolved) {
        params.set("showResolved", "true");
      } else {
        params.delete("showResolved");
      }

      if (newFilters.minItemCount !== DEFAULT_FILTERS.minItemCount) {
        params.set("minItemCount", String(newFilters.minItemCount));
      } else {
        params.delete("minItemCount");
      }

      if (newFilters.sortBy !== DEFAULT_FILTERS.sortBy) {
        params.set("sortBy", newFilters.sortBy);
      } else {
        params.delete("sortBy");
      }

      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname, filters]
  );

  const handleStatusesChange = useCallback(
    (statuses: ClusterStatus[]) => {
      updateFilters({ statuses });
    },
    [updateFilters]
  );

  const handleShowResolvedChange = useCallback(
    (showResolved: boolean) => {
      updateFilters({ showResolved });
    },
    [updateFilters]
  );

  const handleMinItemCountChange = useCallback(
    (minItemCount: number) => {
      updateFilters({ minItemCount });
    },
    [updateFilters]
  );

  const handleSortChange = useCallback(
    (sortBy: "itemCount" | "createdAt") => {
      updateFilters({ sortBy });
    },
    [updateFilters]
  );

  const handleClearFilters = useCallback(() => {
    router.push(pathname, { scroll: false });
  }, [router, pathname]);

  // -------------------------------------------------------------------------
  // API params
  // -------------------------------------------------------------------------

  const apiParams = useMemo(() => {
    const params = new URLSearchParams();

    if (filters.statuses.length > 0) {
      params.set("statuses", filters.statuses.join(","));
    }

    if (filters.minItemCount > 1) {
      params.set("minItemCount", String(filters.minItemCount));
    }

    params.set("sortBy", filters.sortBy);

    return params;
  }, [filters]);

  // -------------------------------------------------------------------------
  // Data fetching + row flattening
  // -------------------------------------------------------------------------

  const clustersQuery = useClustersByTopicQuery(apiParams);

  const rows = useMemo<ClusterRow[]>(() => {
    const groups = clustersQuery.data?.groups ?? [];
    const flat: ClusterRow[] = [];
    for (const group of groups) {
      const topicTitle = group.topic?.title ?? "";
      for (const cluster of group.clusters) {
        flat.push({ ...cluster, topicTitle });
      }
    }
    return flat;
  }, [clustersQuery.data]);

  return {
    filters,
    updateFilters,
    handleStatusesChange,
    handleShowResolvedChange,
    handleMinItemCountChange,
    handleSortChange,
    handleClearFilters,
    apiParams,
    clustersQuery,
    rows,
  };
}
