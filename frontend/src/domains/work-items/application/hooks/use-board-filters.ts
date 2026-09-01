"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTags } from "@/domains/tags/application/hooks/use-tags";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useUrlDynamicFilters } from "@/domains/shared/application/hooks/use-url-dynamic-filters";
import { useViewPreferences } from "@/domains/shared/application/hooks/use-view-preferences";
import { createBoardFiltersConfig } from "../../domain/board-filters.config";
import type { FilterOption } from "@/domains/shared/domain/filter-types";
import type { GroupByMode, BoardFilterPreferences, BoardSortBy } from "../../domain/types";
import {
  getBoardFilterParamsFromSearchParams,
  hasExplicitBoardFilterParams,
  mergePersistedBoardFilterParams,
  PERSISTABLE_BOARD_FILTER_KEYS,
} from "../../domain/board-filter-params";

/**
 * Keys whose values are persisted to the backend via useViewPreferences.
 * Search is excluded (too transient); excludedIds stay in localStorage.
 */
const PERSISTABLE_FILTER_KEYS = PERSISTABLE_BOARD_FILTER_KEYS;

const BOARD_FILTER_DEFAULTS: BoardFilterPreferences = {
  groupBy: "none",
};

const buildPageKey = (boardId: string, area?: string): string =>
  area ? `board-area-${area}` : `board-${boardId}`;

const buildPersistableSnapshot = (
  source: Partial<Record<(typeof PERSISTABLE_FILTER_KEYS)[number], string | undefined>>
): string =>
  PERSISTABLE_FILTER_KEYS.map((key) => `${key}:${source[key] ?? ""}`).join("|");

export const useBoardFilters = (
  assigneeOptions: FilterOption[] = [],
  options?: { boardId?: string; area?: string }
) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const boardId = options?.boardId ?? "";
  const area = options?.area;
  const pageKey = buildPageKey(boardId, area);

  // Backend-persisted view preferences
  const {
    preferences: viewPrefs,
    isLoaded: isPrefsLoaded,
    updatePreference,
  } = useViewPreferences<BoardFilterPreferences>(pageKey, BOARD_FILTER_DEFAULTS);

  const { data: tags } = useTags();
  const { data: projects } = useProjects();

  // --- Search (URL-synced, NOT persisted) ---
  const searchFromUrl = searchParams.get("search") || "";
  const [search, setSearchLocal] = useState(searchFromUrl);
  const [debouncedSearch, setDebouncedSearch] = useState(searchFromUrl);

  // --- GroupBy: URL > saved preference > default ---
  const groupByFromUrlRaw = searchParams.get("groupBy");
  const hasGroupByInUrl = groupByFromUrlRaw !== null;

  const parseGroupBy = (raw: string | null | undefined): GroupByMode => {
    if (
      raw === "parent" ||
      raw === "epic" ||
      raw === "feature" ||
      raw === "story" ||
      raw === "hierarchy" ||
      raw === "topmost"
    ) {
      return raw;
    }

    return "none";
  };

  // Resolve: URL takes priority, then saved preference, then default
  const resolvedGroupBy: GroupByMode = hasGroupByInUrl
    ? parseGroupBy(groupByFromUrlRaw)
    : parseGroupBy(viewPrefs.groupBy);
  const groupBy = resolvedGroupBy;

  // Keep the board query disabled until the saved filters have been applied to
  // the URL (or explicitly superseded by URL filters). This avoids rendering
  // an unfiltered board during the preference-restoration render.
  const [appliedPrefsPageKey, setAppliedPrefsPageKey] = useState<string | null>(null);
  const prefsAppliedForPage = appliedPrefsPageKey === pageKey;

  const setGroupBy = useCallback(
    (mode: GroupByMode) => {
      const params = new URLSearchParams(searchParams.toString());
      if (mode === "none") {
        params.delete("groupBy");
      } else {
        params.set("groupBy", mode);
      }
      const currentParamString = searchParams.toString();
      const paramString = params.toString();
      const url = paramString ? `${pathname}?${paramString}` : pathname;
      const currentUrl = currentParamString
        ? `${pathname}?${currentParamString}`
        : pathname;
      if (url !== currentUrl) {
        router.push(url, { scroll: false });
      }

      // Persist to backend
      updatePreference("groupBy", mode);
    },
    [searchParams, router, pathname, updatePreference]
  );

  // --- Sort (URL-synced, NOT persisted) ---
  const VALID_SORT_BY: BoardSortBy[] = ["manual", "priority", "createdAt", "updatedAt", "dueDate"];
  const sortByFromUrl = searchParams.get("sortBy") as BoardSortBy | null;
  const sortDirectionFromUrl = searchParams.get("sortDirection") as "asc" | "desc" | null;

  const sortBy: BoardSortBy = sortByFromUrl && VALID_SORT_BY.includes(sortByFromUrl) ? sortByFromUrl : "manual";
  const sortDirection: "asc" | "desc" = sortDirectionFromUrl === "asc" || sortDirectionFromUrl === "desc" ? sortDirectionFromUrl : "asc";

  const setSort = useCallback(
    (newSortBy: BoardSortBy, newSortDirection: "asc" | "desc") => {
      const params = new URLSearchParams(searchParams.toString());
      if (newSortBy === "manual" && newSortDirection === "asc") {
        // Default state: remove from URL
        params.delete("sortBy");
        params.delete("sortDirection");
      } else {
        params.set("sortBy", newSortBy);
        params.set("sortDirection", newSortDirection);
      }
      const paramString = params.toString();
      const url = paramString ? `${pathname}?${paramString}` : pathname;
      router.push(url, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  // Sync local search state when URL changes externally (back/forward navigation)
  useEffect(() => {
    const syncId = window.setTimeout(() => {
      setSearchLocal((prev) => (prev === searchFromUrl ? prev : searchFromUrl));
      setDebouncedSearch((prev) => (prev === searchFromUrl ? prev : searchFromUrl));
    }, 0);

    return () => {
      window.clearTimeout(syncId);
    };
  }, [searchFromUrl]);

  // Debounce: update URL after 300ms of no typing
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);

      // Push debounced search to URL
      if (search !== searchFromUrl) {
        const params = new URLSearchParams(searchParams.toString());
        if (search) {
          params.set("search", search);
        } else {
          params.delete("search");
        }
        const paramString = params.toString();
        const url = paramString ? `${pathname}?${paramString}` : pathname;
        router.push(url, { scroll: false });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, searchFromUrl, searchParams, router, pathname]);

  const setSearch = useCallback((value: string) => {
    setSearchLocal(value);
  }, []);

  const t = useTranslations("workItems.boardFilters");

  const tagOptions: FilterOption[] = useMemo(
    () => (tags ?? []).map((t) => ({ value: t.id, label: t.name })),
    [tags]
  );

  const projectOptions: FilterOption[] = useMemo(
    () => (projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    [projects]
  );

  const labels = useMemo(() => ({
    priority: t("priority"),
    assignee: t("assignee"),
    project: t("project"),
    assigneePlaceholder: t("assigneePlaceholder"),
    priorityUrgent: t("priorityUrgent"),
    priorityHigh: t("priorityHigh"),
    priorityMedium: t("priorityMedium"),
    priorityLow: t("priorityLow"),
  }), [t]);

  const config = useMemo(
    () => createBoardFiltersConfig(tagOptions, projectOptions, assigneeOptions, labels),
    [tagOptions, projectOptions, assigneeOptions, labels]
  );

  const dynamicFilters = useUrlDynamicFilters(config);

  const hasExplicitFilterParams = useMemo(
    () =>
      hasExplicitBoardFilterParams(searchParams) ||
      config.definitions.some((definition) => searchParams.has(definition.id)),
    [config.definitions, searchParams],
  );

  // --- Restore saved filters into URL on initial load ---
  // Only applies when there are NO filter-related URL params and preferences have loaded
  useEffect(() => {
    if (!isPrefsLoaded || prefsAppliedForPage) return;

    let cancelled = false;
    const schedulePrefsApplied = () => {
      queueMicrotask(() => {
        if (!cancelled) setAppliedPrefsPageKey(pageKey);
      });
    };

    // Grouping is independent from dynamic filters. Only explicit dynamic
    // filter params should prevent restoring saved filter values.
    if (hasExplicitFilterParams) {
      schedulePrefsApplied();
      return () => {
        cancelled = true;
      };
    }

    // Build URL params from saved preferences
    const params = new URLSearchParams(searchParams.toString());
    let hasChanges = false;

    // Restore groupBy
    if (viewPrefs.groupBy && viewPrefs.groupBy !== "none") {
      if (params.get("groupBy") !== viewPrefs.groupBy) {
        params.set("groupBy", viewPrefs.groupBy);
        hasChanges = true;
      }
    }

    // Restore dynamic filter values
    for (const key of PERSISTABLE_FILTER_KEYS) {
      const savedValue = viewPrefs[key];
      if (savedValue && typeof savedValue === "string" && savedValue.length > 0) {
        if (params.get(key) !== savedValue) {
          params.set(key, savedValue);
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      const paramString = params.toString();
      const url = paramString ? `${pathname}?${paramString}` : pathname;
      router.replace(url, { scroll: false });
      return () => {
        cancelled = true;
      };
    }

    schedulePrefsApplied();
    return () => {
      cancelled = true;
    };
  }, [
    hasExplicitFilterParams,
    isPrefsLoaded,
    pageKey,
    pathname,
    prefsAppliedForPage,
    router,
    searchParams,
    viewPrefs,
  ]);

  // --- Persist dynamic filter changes to backend ---
  // Watches the appliedFilters from useUrlDynamicFilters and persists changes
  const prevSentSnapshotRef = useRef<string>("");

  useEffect(() => {
    prevSentSnapshotRef.current = "";
  }, [pageKey]);

  useEffect(() => {
    if (!isPrefsLoaded || !prefsAppliedForPage) return;

    const currentParams = {
      ...getBoardFilterParamsFromSearchParams(searchParams),
      ...dynamicFilters.getFilterParams(),
    };
    const currentSnapshot = buildPersistableSnapshot({
      priority: currentParams.priority,
      assignee: currentParams.assignee,
      tagIds: currentParams.tagIds,
      projectId: currentParams.projectId,
      isBug: currentParams.isBug,
    });
    const savedSnapshot = buildPersistableSnapshot({
      priority: viewPrefs.priority,
      assignee: viewPrefs.assignee,
      tagIds: viewPrefs.tagIds,
      projectId: viewPrefs.projectId,
      isBug: viewPrefs.isBug,
    });

    // Nothing to persist.
    if (currentSnapshot === savedSnapshot) return;

    // Prevent re-sending the same pending payload while backend/cache settle.
    if (currentSnapshot === prevSentSnapshotRef.current) return;
    prevSentSnapshotRef.current = currentSnapshot;

    // Persist each persistable filter key
    for (const key of PERSISTABLE_FILTER_KEYS) {
      const value = currentParams[key] ?? "";
      const savedValue = viewPrefs[key] ?? "";
      if (value !== savedValue) {
        updatePreference(key, value || undefined);
      }
    }
  }, [
    dynamicFilters,
    isPrefsLoaded,
    prefsAppliedForPage,
    searchParams,
    updatePreference,
    viewPrefs,
  ]);

  const getFilterParams = dynamicFilters.getFilterParams;
  const filterParams = useMemo(() => {
    const params = {
      ...getBoardFilterParamsFromSearchParams(searchParams),
      ...getFilterParams(),
    };
    if (debouncedSearch) params.search = debouncedSearch;

    // Query with the restored preferences immediately. The URL replacement in
    // the effect above is presentation-only and must not be the first moment
    // the backend receives the user's saved filters.
    const shouldApplyPersistedFilters = !prefsAppliedForPage;
    const resolvedParams = shouldApplyPersistedFilters
      ? mergePersistedBoardFilterParams(params, viewPrefs, hasExplicitFilterParams)
      : params;

    return Object.keys(resolvedParams).length > 0 ? resolvedParams : undefined;
  }, [
    debouncedSearch,
    getFilterParams,
    hasExplicitFilterParams,
    prefsAppliedForPage,
    searchParams,
    viewPrefs,
  ]);

  return {
    search,
    setSearch,
    config,
    dynamicFilters,
    filterParams,
    groupBy,
    setGroupBy,
    sortBy,
    sortDirection,
    setSort,
    isPrefsLoaded: isPrefsLoaded && prefsAppliedForPage,
  };
};
