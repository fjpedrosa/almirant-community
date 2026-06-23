"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { planningSessionKeys } from "../../domain/query-keys";
import { planningSessionsApi } from "../../infrastructure/api/planning-api";
import type {
  PaginatedPlanningSessionsResponse,
  PlanningSessionFilters,
  PlanningSessionStatus,
} from "../../domain/types";

const DEFAULT_LIMIT = 20;

// ---------------------------------------------------------------------------
// URL-synced filters
// ---------------------------------------------------------------------------

export const useSessionHistoryFilters = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo((): PlanningSessionFilters => {
    return {
      status:
        (searchParams.get("status") as PlanningSessionStatus) || undefined,
      projectId: searchParams.get("projectId") || undefined,
      createdByUserId: searchParams.get("createdByUserId") || undefined,
      page: parseInt(searchParams.get("page") || "1", 10),
      limit: parseInt(
        searchParams.get("limit") || String(DEFAULT_LIMIT),
        10
      ),
    };
  }, [searchParams]);

  const setFilters = useCallback(
    (newFilters: Partial<PlanningSessionFilters>) => {
      const params = new URLSearchParams(searchParams.toString());

      // Reset page when filters change (except for page itself)
      if (!("page" in newFilters)) {
        params.delete("page");
      }

      Object.entries(newFilters).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });

      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const setStatus = useCallback(
    (status: PlanningSessionStatus | undefined) => {
      setFilters({ status });
    },
    [setFilters]
  );

  const setProjectId = useCallback(
    (projectId: string | undefined) => {
      setFilters({ projectId });
    },
    [setFilters]
  );

  const setPage = useCallback(
    (page: number) => {
      setFilters({ page });
    },
    [setFilters]
  );

  const clearFilters = useCallback(() => {
    router.push(pathname, { scroll: false });
  }, [router, pathname]);

  const buildSearchParams = useCallback((): URLSearchParams => {
    const params = new URLSearchParams();

    if (filters.status) params.set("status", filters.status);
    if (filters.projectId) params.set("projectId", filters.projectId);
    if (filters.createdByUserId)
      params.set("createdByUserId", filters.createdByUserId);
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));

    return params;
  }, [filters]);

  const hasActiveFilters = useMemo(() => {
    return !!(filters.status || filters.projectId || filters.createdByUserId);
  }, [filters]);

  return {
    filters,
    setFilters,
    setStatus,
    setProjectId,
    setPage,
    clearFilters,
    buildSearchParams,
    hasActiveFilters,
  };
};

// ---------------------------------------------------------------------------
// Paginated query
// ---------------------------------------------------------------------------

export const useSessionHistory = (params?: URLSearchParams) => {
  const query = useQuery({
    queryKey: planningSessionKeys.list(
      `paginated:${params?.toString() ?? ""}`
    ),
    queryFn: async (): Promise<PaginatedPlanningSessionsResponse> => {
      const result = await planningSessionsApi.listWithMeta(params);
      return {
        items: result.data,
        meta: result.meta,
      };
    },
    placeholderData: keepPreviousData,
  });

  return {
    sessions: query.data?.items ?? [],
    meta: query.data?.meta ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
};

// ---------------------------------------------------------------------------
// Delete mutation
// ---------------------------------------------------------------------------

export const useDeleteSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => planningSessionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: planningSessionKeys.all,
      });
    },
  });
};
