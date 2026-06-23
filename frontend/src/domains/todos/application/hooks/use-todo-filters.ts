"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useViewPreferences } from "@/domains/shared/application/hooks/use-view-preferences";
import { useScrollToTop } from "@/domains/shared/application/hooks/use-scroll-to-top";
import type {
  TodoItemFilters,
  TodoItemPriority,
  TodoItemStatus,
  TodosViewPreferences,
} from "../../domain/types";

const DEFAULT_LIMIT = 25;

/** Keys that get persisted to user_view_preferences */
const PERSISTABLE_KEYS: ReadonlyArray<keyof TodosViewPreferences> = [
  "status",
  "priority",
  "ownerUserId",
  "projectId",
  "dueDate",
];

export const useTodoFilters = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("todos.filters");
  const tShared = useTranslations("shared.filters");
  const { scrollToTop } = useScrollToTop();

  // Persistent filter preferences
  const {
    preferences: savedFilters,
    isLoaded: isPrefsLoaded,
    updatePreference,
  } = useViewPreferences<TodosViewPreferences>("todos", {});

  // Resolve filters: URL params > saved preferences > defaults (undefined)
  const filters = useMemo<TodoItemFilters>(() => {
    const urlStatus = searchParams.get("status");
    const urlPriority = searchParams.get("priority");
    const urlOwnerUserId = searchParams.get("ownerUserId");
    const urlProjectId = searchParams.get("projectId");
    const urlDueDate = searchParams.get("dueDate");
    const urlSortBy = searchParams.get("sortBy");
    const urlSortDirection = searchParams.get("sortDirection") as "asc" | "desc" | null;

    return {
      status: (urlStatus as TodoItemStatus) || savedFilters.status || undefined,
      priority:
        (urlPriority as TodoItemPriority) ||
        savedFilters.priority ||
        undefined,
      ownerUserId:
        urlOwnerUserId || savedFilters.ownerUserId || undefined,
      projectId:
        urlProjectId || savedFilters.projectId || undefined,
      dueDate: urlDueDate || savedFilters.dueDate || undefined,
      search: searchParams.get("search") || undefined,
      showAllDone:
        searchParams.get("showAllDone") === "true" ? true : undefined,
      sortBy: urlSortBy || "createdAt",
      sortDirection: urlSortDirection || "desc",
      page: parseInt(searchParams.get("page") || "1", 10),
      limit: parseInt(
        searchParams.get("limit") || String(DEFAULT_LIMIT),
        10,
      ),
    };
  }, [searchParams, savedFilters]);

  const setFilters = useCallback(
    (nextFilters: Partial<TodoItemFilters>) => {
      const params = new URLSearchParams(searchParams.toString());

      if (!("page" in nextFilters)) {
        params.delete("page");
      }

      Object.entries(nextFilters).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });

      // Persist persistable filter keys to backend preferences
      for (const key of PERSISTABLE_KEYS) {
        if (key in nextFilters) {
          updatePreference(key, nextFilters[key as keyof typeof nextFilters] as TodosViewPreferences[typeof key]);
        }
      }

      router.push(`${pathname}?${params.toString()}`, { scroll: false });
      scrollToTop();
    },
    [pathname, router, searchParams, updatePreference, scrollToTop],
  );

  const setSearch = useCallback(
    (search: string) => setFilters({ search: search || undefined }),
    [setFilters],
  );

  const setStatus = useCallback(
    (status: TodoItemStatus | undefined) => setFilters({ status }),
    [setFilters],
  );

  const setPriority = useCallback(
    (priority: TodoItemPriority | undefined) => setFilters({ priority }),
    [setFilters],
  );

  const setOwnerUserId = useCallback(
    (ownerUserId: string | undefined) => setFilters({ ownerUserId }),
    [setFilters],
  );

  const setProjectId = useCallback(
    (projectId: string | undefined) => setFilters({ projectId }),
    [setFilters],
  );

  const setDueDate = useCallback(
    (dueDate: string | undefined) => setFilters({ dueDate }),
    [setFilters],
  );

  const setShowAllDone = useCallback(
    (showAllDone: boolean | undefined) => setFilters({ showAllDone }),
    [setFilters],
  );

  const setPage = useCallback(
    (page: number) => setFilters({ page }),
    [setFilters],
  );

  const setSort = useCallback(
    (sortBy: string, sortDirection: "asc" | "desc") => {
      setFilters({ sortBy, sortDirection, page: 1 });
    },
    [setFilters],
  );

  const clearFilters = useCallback(() => {
    // Clear all persisted preferences
    for (const key of PERSISTABLE_KEYS) {
      updatePreference(key, undefined as TodosViewPreferences[typeof key]);
    }
    router.push(pathname, { scroll: false });
    scrollToTop();
  }, [pathname, router, updatePreference, scrollToTop]);

  const removeFilter = useCallback(
    (key: keyof TodoItemFilters) => {
      // Also clear from preferences if it's a persistable key
      if (PERSISTABLE_KEYS.includes(key as keyof TodosViewPreferences)) {
        updatePreference(
          key as keyof TodosViewPreferences,
          undefined as TodosViewPreferences[keyof TodosViewPreferences],
        );
      }
      setFilters({ [key]: undefined });
    },
    [setFilters, updatePreference],
  );

  const buildSearchParams = useCallback(() => {
    const params = new URLSearchParams();

    if (filters.status) params.set("status", filters.status);
    if (filters.priority) params.set("priority", filters.priority);
    if (filters.ownerUserId)
      params.set("ownerUserId", filters.ownerUserId);
    if (filters.projectId) params.set("projectId", filters.projectId);
    if (filters.search) params.set("search", filters.search);
    if (filters.dueDate) params.set("dueDate", filters.dueDate);
    if (filters.showAllDone) params.set("showAllDone", "true");
    if (filters.sortBy) params.set("sortBy", filters.sortBy);
    if (filters.sortDirection) params.set("sortOrder", filters.sortDirection);
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));

    return params;
  }, [filters]);

  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.status ||
      filters.priority ||
      filters.ownerUserId ||
      filters.projectId ||
      filters.search ||
      filters.dueDate
    );
  }, [filters]);

  const activeFilters = useMemo(() => {
    const result: Array<{
      key: keyof TodoItemFilters;
      label: string;
      value: string;
    }> = [];

    if (filters.status)
      result.push({ key: "status", label: t("status"), value: filters.status });
    if (filters.priority)
      result.push({
        key: "priority",
        label: t("priority"),
        value: filters.priority,
      });
    if (filters.ownerUserId) {
      const ownerCount = filters.ownerUserId.split(",").filter(Boolean).length;
      result.push({
        key: "ownerUserId",
        label: t("owner"),
        value: ownerCount > 1 ? tShared("ownerCount", { count: ownerCount }) : filters.ownerUserId,
      });
    }
    if (filters.projectId)
      result.push({
        key: "projectId",
        label: t("project"),
        value: filters.projectId,
      });
    if (filters.search)
      result.push({
        key: "search",
        label: t("search"),
        value: filters.search,
      });
    if (filters.dueDate)
      result.push({
        key: "dueDate",
        label: t("dueDate"),
        value: filters.dueDate,
      });

    return result;
  }, [filters, t, tShared]);

  return {
    filters,
    isPrefsLoaded,
    setFilters,
    setSearch,
    setStatus,
    setPriority,
    setOwnerUserId,
    setProjectId,
    setDueDate,
    setShowAllDone,
    setPage,
    setSort,
    clearFilters,
    removeFilter,
    buildSearchParams,
    hasActiveFilters,
    activeFilters,
  };
};
