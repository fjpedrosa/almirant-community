"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AgentJob } from "../../domain/types";

const FILTER_QUERY_KEYS = ["boundary", "recurrenceOnly"] as const;

export interface AgentJobFilters {
  boundary: string | null;
  recurrenceOnly: boolean;
}

export interface UseAgentJobFiltersReturn {
  filters: AgentJobFilters;
  setFilter: <K extends keyof AgentJobFilters>(
    key: K,
    value: AgentJobFilters[K]
  ) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  filterJobs: (jobs: AgentJob[]) => AgentJob[];
}

const isRecurrentJob = (job: AgentJob): boolean => {
  const recurrenceType = job.recurrenceType;
  return (
    recurrenceType === "exact_recurrence" ||
    recurrenceType === "cross_runtime_recurrence" ||
    recurrenceType === "variant"
  );
};

export const useAgentJobFilters = (): UseAgentJobFiltersReturn => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo<AgentJobFilters>(
    () => ({
      boundary: searchParams.get("boundary") || null,
      recurrenceOnly: searchParams.get("recurrenceOnly") === "true",
    }),
    [searchParams]
  );

  const setFilter = useCallback(
    <K extends keyof AgentJobFilters>(key: K, value: AgentJobFilters[K]) => {
      const params = new URLSearchParams(searchParams.toString());

      if (value === null || value === false || value === "") {
        params.delete(key);
      } else if (typeof value === "boolean") {
        params.set(key, value ? "true" : "false");
      } else {
        params.set(key, value);
      }

      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());

    FILTER_QUERY_KEYS.forEach((key) => params.delete(key));

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const hasActiveFilters = useMemo(
    () =>
      FILTER_QUERY_KEYS.some((key) => {
        const value = searchParams.get(key);
        if (key === "recurrenceOnly") {
          return value === "true";
        }
        return Boolean(value);
      }),
    [searchParams]
  );

  const filterJobs = useCallback(
    (jobs: AgentJob[]): AgentJob[] => {
      return jobs.filter((job) => {
        // Filter by boundary
        if (filters.boundary != null && filters.boundary !== "") {
          if (job.boundary !== filters.boundary) {
            return false;
          }
        }

        // Filter by recurrence only
        if (filters.recurrenceOnly) {
          if (!isRecurrentJob(job)) {
            return false;
          }
        }

        return true;
      });
    },
    [filters]
  );

  return {
    filters,
    setFilter,
    clearFilters,
    hasActiveFilters,
    filterJobs,
  };
};
