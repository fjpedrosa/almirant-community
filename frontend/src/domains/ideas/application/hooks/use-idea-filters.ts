"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useViewPreferences } from "@/domains/shared/application/hooks/use-view-preferences";
import { useScrollToTop } from "@/domains/shared/application/hooks/use-scroll-to-top";
import type { IdeaItemFilters, IdeaItemStatus, IdeaItemType, IdeaTabValue, IdeasViewPreferences } from "../../domain/types";

const DEFAULT_LIMIT = 25;

// Keys that are persisted in view preferences (not search, page, limit, showAllDone, type)
const PERSISTABLE_KEYS = [
  "status",
  "ownerUserId",
  "projectId",
  "tagIds",
  "discussed",
  "dueDate",
  "mentionedUserId",
] as const;

const PERSISTABLE_SET = new Set<string>(PERSISTABLE_KEYS);

export const useIdeaFilters = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("ideas.filters");
  const tShared = useTranslations("shared.filters");
  const { scrollToTop } = useScrollToTop();

  // Persistent view preferences (view mode + tab + content filters)
  const {
    preferences: viewPrefs,
    isLoaded: isPrefsLoaded,
    updatePreference,
  } = useViewPreferences<IdeasViewPreferences>("ideas", {
    tab: "all",
  });

  const filters = useMemo<IdeaItemFilters>(() => {
    const discussedRaw = searchParams.get("discussed");
    const parseCsv = (value: string | null): string[] | undefined => {
      if (!value) return undefined;
      const values = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      return values.length > 0 ? values : undefined;
    };

    // Helper: resolve a string filter from URL first, then saved preference
    const resolveString = (key: Exclude<typeof PERSISTABLE_KEYS[number], "tagIds">): string | undefined => {
      if (searchParams.has(key)) return searchParams.get(key) || undefined;
      const saved = viewPrefs[key];
      return typeof saved === "string" ? saved : undefined;
    };

    const tagIds = (() => {
      if (searchParams.has("tagIds")) {
        return parseCsv(searchParams.get("tagIds"));
      }
      // Backward compatibility with old single-tag query param.
      if (searchParams.has("tagId")) {
        return parseCsv(searchParams.get("tagId"));
      }
      const saved = viewPrefs.tagIds;
      return typeof saved === "string" ? parseCsv(saved) : undefined;
    })();

    // Resolve discussed: URL > saved pref > undefined
    let discussed: boolean | undefined;
    if (searchParams.has("discussed")) {
      discussed = discussedRaw === "true" ? true : discussedRaw === "false" ? false : undefined;
    } else if (viewPrefs.discussed !== undefined) {
      discussed = viewPrefs.discussed;
    }

    const urlSortBy = searchParams.get("sortBy");
    const urlSortDirection = searchParams.get("sortDirection") as "asc" | "desc" | null;

    return {
      type: (searchParams.get("type") as IdeaItemType) || undefined,
      status: resolveString("status") as IdeaItemStatus | undefined,
      ownerUserId: resolveString("ownerUserId"),
      projectId: resolveString("projectId"),
      tagIds,
      search: searchParams.get("search") || undefined,
      dueDate: resolveString("dueDate"),
      discussed,
      showAllDone: searchParams.get("showAllDone") === "true" ? true : undefined,
      mentionedUserId: resolveString("mentionedUserId"),
      sortBy: urlSortBy || "createdAt",
      sortDirection: urlSortDirection || "desc",
      page: parseInt(searchParams.get("page") || "1", 10),
      limit: parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
    };
  }, [searchParams, viewPrefs]);

  // Persist filter changes to view preferences for persistable keys
  const persistFilterChanges = useCallback(
    (nextFilters: Partial<IdeaItemFilters>) => {
      for (const [key, value] of Object.entries(nextFilters)) {
        if (PERSISTABLE_SET.has(key)) {
          const prefKey = key as keyof IdeasViewPreferences;
          updatePreference(prefKey, value as IdeasViewPreferences[typeof prefKey]);
        }
      }
    },
    [updatePreference]
  );

  const setFilters = useCallback(
    (nextFilters: Partial<IdeaItemFilters>) => {
      const params = new URLSearchParams(searchParams.toString());

      if (!("page" in nextFilters)) {
        params.delete("page");
      }

      Object.entries(nextFilters).forEach(([key, value]) => {
        if (
          value === undefined ||
          value === null ||
          value === "" ||
          (Array.isArray(value) && value.length === 0)
        ) {
          params.delete(key);
          if (key === "tagIds") params.delete("tagId");
        } else {
          params.set(key, Array.isArray(value) ? value.join(",") : String(value));
          if (key === "tagIds") params.delete("tagId");
        }
      });

      router.push(`${pathname}?${params.toString()}`, { scroll: false });
      scrollToTop();

      // Persist persistable filter keys to view preferences
      persistFilterChanges(nextFilters);
    },
    [pathname, router, searchParams, persistFilterChanges, scrollToTop]
  );

  const setSearch = useCallback(
    (search: string) => setFilters({ search: search || undefined }),
    [setFilters]
  );

  const setType = useCallback(
    (type: IdeaItemType | undefined) => setFilters({ type }),
    [setFilters]
  );

  const setStatus = useCallback(
    (status: IdeaItemStatus | undefined) => setFilters({ status }),
    [setFilters]
  );

  const setOwnerUserId = useCallback(
    (ownerUserId: string | undefined) => setFilters({ ownerUserId }),
    [setFilters]
  );

  const setProjectId = useCallback(
    (projectId: string | undefined) => setFilters({ projectId }),
    [setFilters]
  );

  const setTagIds = useCallback(
    (tagIds: string[] | undefined) => setFilters({ tagIds }),
    [setFilters]
  );

  const setDueDate = useCallback(
    (dueDate: string | undefined) => setFilters({ dueDate }),
    [setFilters]
  );

  const setDiscussed = useCallback(
    (discussed: boolean | undefined) =>
      setFilters({ discussed }),
    [setFilters]
  );

  const setMentionedUserId = useCallback(
    (mentionedUserId: string | undefined) => setFilters({ mentionedUserId }),
    [setFilters]
  );

  const setShowAllDone = useCallback(
    (showAllDone: boolean | undefined) =>
      setFilters({ showAllDone }),
    [setFilters]
  );

  const setPage = useCallback(
    (page: number) => setFilters({ page }),
    [setFilters]
  );

  const setSort = useCallback(
    (sortBy: string, sortDirection: "asc" | "desc") => {
      setFilters({ sortBy, sortDirection, page: 1 });
    },
    [setFilters]
  );

  const clearFilters = useCallback(() => {
    router.push(pathname, { scroll: false });
    scrollToTop();
    // Clear all persisted filter preferences
    for (const key of PERSISTABLE_KEYS) {
      updatePreference(key, undefined as IdeasViewPreferences[typeof key]);
    }
  }, [pathname, router, updatePreference, scrollToTop]);

  const removeFilter = useCallback(
    (key: keyof IdeaItemFilters) => {
      setFilters({ [key]: undefined });
    },
    [setFilters]
  );

  const buildSearchParams = useCallback(() => {
    const params = new URLSearchParams();

    if (filters.type) params.set("type", filters.type);
    if (filters.status) params.set("status", filters.status);
    if (filters.ownerUserId) params.set("ownerUserId", filters.ownerUserId);
    if (filters.projectId) params.set("projectId", filters.projectId);
    if (filters.tagIds && filters.tagIds.length > 0) {
      params.set("tagIds", filters.tagIds.join(","));
    }
    if (filters.search) params.set("search", filters.search);
    if (filters.dueDate) params.set("dueDate", filters.dueDate);
    if (filters.discussed !== undefined) params.set("discussed", String(filters.discussed));
    if (filters.showAllDone) params.set("showAllDone", "true");
    if (filters.mentionedUserId) params.set("mentionedUserId", filters.mentionedUserId);
    if (filters.sortBy) params.set("sortBy", filters.sortBy);
    if (filters.sortDirection) params.set("sortOrder", filters.sortDirection);
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));

    return params;
  }, [filters]);

  const tab = useMemo<IdeaTabValue>(() => {
    // URL type param takes priority over saved preference
    if (filters.type === "idea") return "ideas";
    // If URL has explicit type param (even if empty/cleared), use "all"
    if (searchParams.has("type")) return "all";
    // Otherwise, fall back to saved preference
    return viewPrefs.tab;
  }, [filters.type, searchParams, viewPrefs.tab]);

  const setTab = useCallback(
    (value: string) => {
      const typeMap: Record<string, IdeaItemType | undefined> = {
        ideas: "idea",
        all: undefined,
      };
      setType(typeMap[value]);
      updatePreference("tab", value as IdeaTabValue);
    },
    [setType, updatePreference]
  );

  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.type ||
      filters.status ||
      filters.ownerUserId ||
      filters.projectId ||
      (filters.tagIds && filters.tagIds.length > 0) ||
      filters.search ||
      filters.dueDate ||
      filters.discussed !== undefined ||
      filters.mentionedUserId
    );
  }, [filters]);

  const activeFilters = useMemo(() => {
    const result: Array<{ key: keyof IdeaItemFilters; label: string; value: string }> = [];

    if (filters.type) result.push({ key: "type", label: t("type"), value: filters.type });
    if (filters.status) result.push({ key: "status", label: t("status"), value: filters.status });
    if (filters.ownerUserId) {
      const ownerCount = filters.ownerUserId.split(",").filter(Boolean).length;
      result.push({
        key: "ownerUserId",
        label: t("owner"),
        value: ownerCount > 1 ? tShared("ownerCount", { count: ownerCount }) : filters.ownerUserId,
      });
    }
    if (filters.projectId) result.push({ key: "projectId", label: t("project"), value: filters.projectId });
    if (filters.tagIds && filters.tagIds.length > 0) {
      result.push({
        key: "tagIds",
        label: t("tags"),
        value: filters.tagIds.join(","),
      });
    }
    if (filters.search) result.push({ key: "search", label: t("search"), value: filters.search });
    if (filters.dueDate) result.push({ key: "dueDate", label: t("dueDate"), value: filters.dueDate });
    if (filters.discussed !== undefined) result.push({ key: "discussed", label: t("discussed"), value: filters.discussed ? t("discussedYes") : t("discussedNo") });
    if (filters.mentionedUserId) result.push({ key: "mentionedUserId", label: t("mentioned"), value: t("myMentions") });

    return result;
  }, [filters, t, tShared]);

  return {
    filters,
    tab,
    setTab,
    isPrefsLoaded,
    setFilters,
    setSearch,
    setType,
    setStatus,
    setOwnerUserId,
    setProjectId,
    setTagIds,
    setDueDate,
    setDiscussed,
    setMentionedUserId,
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
