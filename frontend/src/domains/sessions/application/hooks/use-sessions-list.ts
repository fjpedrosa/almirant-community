"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { requestWithMeta } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import {
  stringifyUrlSearchParams,
  useUrlDynamicFilters,
} from "@/domains/shared/application/hooks/use-url-dynamic-filters";
import { createSessionsFiltersConfig } from "../../domain/sessions-filters.config";
import { sessionKeys } from "../../domain/query-keys";
import type {
  AgentSessionListItem,
  PaginatedSessionsResponse,
} from "../../domain/types";
import type { FilterOption } from "@/domains/shared/domain/filter-types";

const DEFAULT_LIMIT = 20;

export const useSessionsFilters = (projects: FilterOption[]) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const config = useMemo(
    () => createSessionsFiltersConfig(projects),
    [projects],
  );

  const dynamicFilters = useUrlDynamicFilters(config);

  // Pagination stays separate from DynamicFilters
  const page = useMemo(
    () => Number.parseInt(searchParams.get("page") || "1", 10),
    [searchParams],
  );

  const limit = useMemo(
    () => Number.parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
    [searchParams],
  );

  const setPage = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextPage <= 1) {
        params.delete("page");
      } else {
        params.set("page", String(nextPage));
      }
      const query = stringifyUrlSearchParams(params);
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const buildSearchParams = useCallback(() => {
    const filterParams = dynamicFilters.getFilterParams();
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    for (const [key, value] of Object.entries(filterParams)) {
      params.set(key, value);
    }
    params.set("includeRelations", "true");
    return params;
  }, [dynamicFilters, page, limit]);

  return {
    config,
    dynamicFilters,
    page,
    setPage,
    buildSearchParams,
  };
};

export const useSessionsList = (params?: URLSearchParams) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(sessionKeys.list(params?.toString() ?? ""));

  const query = useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<PaginatedSessionsResponse> => {
      const result = await requestWithMeta<AgentSessionListItem[]>(
        `/agent-jobs?${params?.toString() ?? ""}`
      );

      return {
        items: result.data,
        meta: result.meta,
      };
    },
    enabled: !!confirmedActiveTeamId,
    placeholderData: keepPreviousData,
  });

  return {
    sessions: query.data?.items ?? [],
    meta: query.data?.meta ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
};
