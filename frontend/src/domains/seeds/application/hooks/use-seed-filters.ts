"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useUrlDynamicFilters } from "@/domains/shared/application/hooks/use-url-dynamic-filters";
import { useViewPreferences } from "@/domains/shared/application/hooks/use-view-preferences";
import { useScrollToTop } from "@/domains/shared/application/hooks/use-scroll-to-top";
import { createSeedsFiltersConfig } from "../../domain/seeds-filters.config";
import type { FilterOption } from "@/domains/shared/domain/filter-types";
import type { SeedsViewPreferences } from "../../domain/types";
import type { SeedsFilterTranslations } from "../../domain/seeds-filters.config";

const DEFAULT_LIMIT = 25;

type SeedStatusGroup = "active" | "finished";

const PERSISTABLE_FILTER_KEYS = [
  "source",
  "priority",
  "ownerUserId",
  "projectId",
  "tagId",
  "selectedForIdeation",
] as const;

const buildPersistableSnapshot = (
  source: Partial<
    Record<(typeof PERSISTABLE_FILTER_KEYS)[number], string | undefined>
  >,
): string =>
  PERSISTABLE_FILTER_KEYS.map((key) => `${key}:${source[key] ?? ""}`).join(
    "|",
  );

export const useSeedFilters = (
  ownerOptions: FilterOption[],
  projectOptions: FilterOption[],
  tagOptions: FilterOption[],
) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { scrollToTop } = useScrollToTop();
  const t = useTranslations("seeds.filtersConfig");

  // --- Build translations object ---
  const translations: SeedsFilterTranslations = useMemo(
    () => ({
      priority: t("priority"),
      source: t("source"),
      owner: t("owner"),
      project: t("project"),
      tag: t("tag"),
      forIdeation: t("forIdeation"),
      searchPlaceholder: t("searchPlaceholder"),
      groupSeed: t("groupSeed"),
      groupMetadata: t("groupMetadata"),
      priorities: {
        urgent: t("priorities.urgent"),
        high: t("priorities.high"),
        medium: t("priorities.medium"),
        low: t("priorities.low"),
      },
      sources: {
        manual: t("sources.manual"),
        feedback: t("sources.feedback"),
        ai_generated: t("sources.ai_generated"),
        import: t("sources.import"),
      },
    }),
    [t],
  );

  // --- Config ---
  const config = useMemo(
    () => createSeedsFiltersConfig(ownerOptions, projectOptions, tagOptions, translations),
    [ownerOptions, projectOptions, tagOptions, translations],
  );

  // --- Dynamic filters (URL-managed) ---
  const dynamicFilters = useUrlDynamicFilters(config);

  // --- Tab (active/finished) ---
  const activeTab = useMemo<SeedStatusGroup>(() => {
    return searchParams.get("tab") === "finished" ? "finished" : "active";
  }, [searchParams]);

  const setTab = useCallback(
    (tab: SeedStatusGroup) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "active") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
      scrollToTop();
    },
    [searchParams, router, pathname, scrollToTop],
  );

  // --- Search (debounced URL param) ---
  const searchFromUrl = searchParams.get("search") || "";
  const [search, setSearchLocal] = useState(searchFromUrl);

  useEffect(() => {
    setSearchLocal((prev) => (prev === searchFromUrl ? prev : searchFromUrl));
  }, [searchFromUrl]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== searchFromUrl) {
        const params = new URLSearchParams(searchParams.toString());
        if (search) {
          params.set("search", search);
        } else {
          params.delete("search");
        }
        params.delete("page");
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
        scrollToTop();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, searchFromUrl, searchParams, router, pathname, scrollToTop]);

  const setSearch = useCallback((value: string) => {
    setSearchLocal(value);
  }, []);

  // --- Pagination ---
  const page = useMemo(
    () => parseInt(searchParams.get("page") || "1", 10),
    [searchParams],
  );
  const limit = useMemo(
    () => parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
    [searchParams],
  );

  // --- Sorting ---
  const sortBy = useMemo(
    () => searchParams.get("sortBy") || "createdAt",
    [searchParams],
  );
  const sortDirection = useMemo<"asc" | "desc">(
    () => (searchParams.get("sortDirection") as "asc" | "desc") || "desc",
    [searchParams],
  );

  const setSort = useCallback(
    (newSortBy: string, newSortDirection: "asc" | "desc") => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("sortBy", newSortBy);
      params.set("sortDirection", newSortDirection);
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
      scrollToTop();
    },
    [searchParams, router, pathname, scrollToTop],
  );

  const setPage = useCallback(
    (p: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (p <= 1) {
        params.delete("page");
      } else {
        params.set("page", String(p));
      }
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
      scrollToTop();
    },
    [searchParams, router, pathname, scrollToTop],
  );

  // --- Persistence ---
  const {
    preferences: viewPrefs,
    isLoaded: isPrefsLoaded,
    updatePreference,
  } = useViewPreferences<SeedsViewPreferences>("seeds", {});

  const hasAppliedPrefsRef = useRef(false);

  // Restore saved filters into URL on initial load
  useEffect(() => {
    if (!isPrefsLoaded || hasAppliedPrefsRef.current) return;
    hasAppliedPrefsRef.current = true;

    const hasFilterParams = config.definitions.some((def) =>
      searchParams.has(def.id),
    );
    if (hasFilterParams) return;

    const params = new URLSearchParams(searchParams.toString());
    let hasChanges = false;

    for (const key of PERSISTABLE_FILTER_KEYS) {
      const savedValue = viewPrefs[key];
      if (savedValue !== undefined && savedValue !== null) {
        const stringValue = String(savedValue);
        if (stringValue.length > 0) {
          params.set(key, stringValue);
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [
    isPrefsLoaded,
    searchParams,
    config.definitions,
    viewPrefs,
    pathname,
    router,
  ]);

  // Persist filter changes to backend
  const prevSentSnapshotRef = useRef<string>("");

  useEffect(() => {
    if (!isPrefsLoaded || !hasAppliedPrefsRef.current) return;

    const currentParams = dynamicFilters.getFilterParams();
    const currentSnapshot = buildPersistableSnapshot({
      source: currentParams.source,
      priority: currentParams.priority,
      ownerUserId: currentParams.ownerUserId,
      projectId: currentParams.projectId,
      tagId: currentParams.tagId,
      selectedForIdeation: currentParams.selectedForIdeation,
    });

    const savedSnapshot = buildPersistableSnapshot({
      source: viewPrefs.source,
      priority: viewPrefs.priority,
      ownerUserId: viewPrefs.ownerUserId,
      projectId: viewPrefs.projectId,
      tagId: viewPrefs.tagId,
      selectedForIdeation:
        viewPrefs.selectedForIdeation !== undefined
          ? String(viewPrefs.selectedForIdeation)
          : undefined,
    });

    if (currentSnapshot === savedSnapshot) return;
    if (currentSnapshot === prevSentSnapshotRef.current) return;
    prevSentSnapshotRef.current = currentSnapshot;

    for (const key of PERSISTABLE_FILTER_KEYS) {
      const value = currentParams[key] ?? "";
      const savedValue =
        viewPrefs[key] !== undefined ? String(viewPrefs[key]) : "";
      if (value !== savedValue) {
        if (key === "selectedForIdeation") {
          updatePreference(
            key,
            value === "true" ? true : value === "false" ? false : undefined,
          );
        } else {
          updatePreference(key, (value || undefined) as never);
        }
      }
    }
  }, [dynamicFilters, isPrefsLoaded, updatePreference, viewPrefs]);

  // --- Build API search params ---
  const buildSearchParams = useCallback(() => {
    const apiParams = new URLSearchParams();

    // Tab → statusGroup
    apiParams.set("statusGroup", activeTab);

    // Dynamic filter values
    const filterParams = dynamicFilters.getFilterParams();
    for (const [key, value] of Object.entries(filterParams)) {
      if (value) apiParams.set(key, value);
    }

    // Search
    if (search) apiParams.set("search", search);

    // Sorting
    if (sortBy) apiParams.set("sortBy", sortBy);
    if (sortDirection) apiParams.set("sortOrder", sortDirection);

    // Pagination
    apiParams.set("page", String(page));
    apiParams.set("limit", String(limit));

    return apiParams;
  }, [activeTab, dynamicFilters, search, sortBy, sortDirection, page, limit]);

  return {
    // DynamicFilters component props
    config,
    dynamicFilters,

    // Tab
    activeTab,
    setTab,

    // Search
    search,
    setSearch,

    // Sorting
    sortBy,
    sortDirection,
    setSort,

    // Pagination
    page,
    setPage,

    // API
    buildSearchParams,

    // State
    isPrefsLoaded,
  };
};
