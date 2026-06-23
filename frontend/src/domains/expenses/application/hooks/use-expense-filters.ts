"use client";
import { useCallback, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ExpenseFilters } from "../../domain/types";

export const useExpenseFilters = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters: ExpenseFilters = useMemo(
    () => ({
      search: searchParams.get("search") ?? undefined,
      status: (searchParams.get("status") ?? undefined) as ExpenseFilters["status"],
      currency: (searchParams.get("currency") ?? undefined) as ExpenseFilters["currency"],
      paidByUserId: searchParams.get("paidByUserId") ?? undefined,
      categoryId: searchParams.get("categoryId") ?? undefined,
      dateFrom: searchParams.get("dateFrom") ?? undefined,
      dateTo: searchParams.get("dateTo") ?? undefined,
      page: Number(searchParams.get("page") ?? "1"),
      limit: Number(searchParams.get("limit") ?? "20"),
    }),
    [searchParams],
  );

  const updateFilter = useCallback(
    <K extends keyof ExpenseFilters>(key: K, value: ExpenseFilters[K] | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === undefined || value === "") {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
      if (key !== "page") params.set("page", "1");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const hasActiveFilters = useMemo(
    () =>
      !!(
        filters.search ||
        filters.status ||
        filters.currency ||
        filters.paidByUserId ||
        filters.categoryId ||
        filters.dateFrom ||
        filters.dateTo
      ),
    [filters],
  );

  const toSearchParams = useMemo((): URLSearchParams => {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.status) params.set("status", filters.status);
    if (filters.currency) params.set("currency", filters.currency);
    if (filters.paidByUserId) params.set("paidByUserId", filters.paidByUserId);
    if (filters.categoryId) params.set("categoryId", filters.categoryId);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    params.set("page", String(filters.page));
    params.set("limit", String(filters.limit));
    return params;
  }, [filters]);

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("limit", String(filters.limit));
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, filters.limit]);

  return {
    filters,
    hasActiveFilters,
    toSearchParams,
    updateFilter,
    clearFilters,
    onSearchChange: (v: string) => updateFilter("search", v || undefined),
    onStatusChange: (v: ExpenseFilters["status"]) => updateFilter("status", v),
    onCurrencyChange: (v: ExpenseFilters["currency"]) => updateFilter("currency", v),
    onPaidByChange: (v: string | undefined) => updateFilter("paidByUserId", v),
    onCategoryChange: (v: string | undefined) => updateFilter("categoryId", v),
    onDateFromChange: (v: string | undefined) => updateFilter("dateFrom", v),
    onDateToChange: (v: string | undefined) => updateFilter("dateTo", v),
  };
};
