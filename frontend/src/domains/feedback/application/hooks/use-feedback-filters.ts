"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type {
  FeedbackItemFilters,
  FeedbackStatus,
  FeedbackCategory,
} from "../../domain/types";

const DEFAULT_LIMIT = 25;

export const useFeedbackFilters = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("feedback");

  // Parse current filters from URL
  const filters = useMemo((): FeedbackItemFilters => {
    return {
      search: searchParams.get("search") || undefined,
      status: (searchParams.get("status") as FeedbackStatus) || undefined,
      category: (searchParams.get("category") as FeedbackCategory) || undefined,
      sourceId: searchParams.get("sourceId") || undefined,
      page: parseInt(searchParams.get("page") || "1", 10),
      limit: parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
    };
  }, [searchParams]);

  // Update URL with new filters
  const setFilters = useCallback(
    (newFilters: Partial<FeedbackItemFilters>) => {
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

  // Set search filter
  const setSearch = useCallback(
    (search: string) => {
      setFilters({ search: search || undefined });
    },
    [setFilters]
  );

  // Set status filter
  const setStatus = useCallback(
    (status: FeedbackStatus | undefined) => {
      setFilters({ status });
    },
    [setFilters]
  );

  // Set category filter
  const setCategory = useCallback(
    (category: FeedbackCategory | undefined) => {
      setFilters({ category });
    },
    [setFilters]
  );

  // Set sourceId filter
  const setSourceId = useCallback(
    (sourceId: string | undefined) => {
      setFilters({ sourceId });
    },
    [setFilters]
  );

  // Set page
  const setPage = useCallback(
    (page: number) => {
      setFilters({ page });
    },
    [setFilters]
  );

  // Clear all filters
  const clearFilters = useCallback(() => {
    router.push(pathname, { scroll: false });
  }, [router, pathname]);

  // Remove a specific filter
  const removeFilter = useCallback(
    (key: keyof FeedbackItemFilters) => {
      setFilters({ [key]: undefined });
    },
    [setFilters]
  );

  // Build URLSearchParams for API call
  const buildSearchParams = useCallback((): URLSearchParams => {
    const params = new URLSearchParams();

    if (filters.search) params.set("search", filters.search);
    if (filters.status) params.set("status", filters.status);
    if (filters.category) params.set("category", filters.category);
    if (filters.sourceId) params.set("sourceId", filters.sourceId);
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));

    return params;
  }, [filters]);

  // Check if any filter is active
  const hasActiveFilters = useMemo(() => {
    return !!(filters.search || filters.status || filters.category || filters.sourceId);
  }, [filters]);

  // Get active filters for display
  const activeFilters = useMemo(() => {
    const active: Array<{
      key: keyof FeedbackItemFilters;
      label: string;
      value: string;
    }> = [];

    if (filters.search) {
      active.push({
        key: "search",
        label: t("filters.search"),
        value: filters.search,
      });
    }
    if (filters.status) {
      active.push({
        key: "status",
        label: t("filters.status"),
        value: t(`statuses.${filters.status}`),
      });
    }
    if (filters.category) {
      active.push({
        key: "category",
        label: t("filters.category"),
        value: t(`categories.${filters.category}`),
      });
    }
    if (filters.sourceId) {
      active.push({
        key: "sourceId",
        label: t("filters.source"),
        value: filters.sourceId,
      });
    }

    return active;
  }, [filters, t]);

  return {
    filters,
    setFilters,
    setSearch,
    setStatus,
    setCategory,
    setSourceId,
    setPage,
    clearFilters,
    removeFilter,
    buildSearchParams,
    hasActiveFilters,
    activeFilters,
  };
};
