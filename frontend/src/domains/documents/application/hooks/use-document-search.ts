"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { documentsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { useDocumentCategories } from "./use-document-categories";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { documentKeys } from "./use-documents";
import type {
  DocumentSearchResult,
  DocumentSearchResponse,
  ProjectOption,
  DocumentCategoryWithCount,
} from "../../domain/types";
import type { ProjectWithRelations } from "@/domains/projects/domain/types";

const SEARCH_DEBOUNCE_MIN_LENGTH = 2;

export const documentSearchKeys = {
  all: [...documentKeys.all, "search"] as const,
  query: (params: string) => [...documentSearchKeys.all, params] as const,
};

export const useDocumentSearch = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const { data: categoriesData } = useDocumentCategories();
  const { data: projectsData } = useProjects();

  const categories: DocumentCategoryWithCount[] = useMemo(
    () => (categoriesData as DocumentCategoryWithCount[]) || [],
    [categoriesData]
  );

  const projects: ProjectOption[] = useMemo(() => {
    if (!projectsData) return [];
    return (projectsData as ProjectWithRelations[])
      .filter((p) => p.status === "active")
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
      }));
  }, [projectsData]);

  const isQueryValid = searchQuery.trim().length >= SEARCH_DEBOUNCE_MIN_LENGTH;

  const searchParams = useMemo(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (filterProjectId) params.set("projectId", filterProjectId);
    if (filterCategoryId) params.set("categoryId", filterCategoryId);
    params.set("limit", "20");
    return params;
  }, [searchQuery, filterProjectId, filterCategoryId]);

  const scopedKey = useOrgScopedKey(documentSearchKeys.query(searchParams.toString()));

  const {
    data: searchData,
    isLoading: isSearching,
    isFetching,
  } = useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<DocumentSearchResponse> => {
      const result = await documentsApi.search(searchParams);
      return {
        items: result.data as DocumentSearchResult[],
        meta: result.meta,
      };
    },
    enabled: isQueryValid && isSearchOpen,
    staleTime: 30_000,
  });

  const results = searchData?.items ?? [];
  const total = searchData?.meta?.total ?? 0;

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleProjectChange = useCallback((projectId: string | null) => {
    setFilterProjectId(projectId);
  }, []);

  const handleCategoryChange = useCallback((categoryId: string | null) => {
    setFilterCategoryId(categoryId);
  }, []);

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setFilterProjectId(null);
    setFilterCategoryId(null);
  }, []);

  return {
    // State
    searchQuery,
    filterProjectId,
    filterCategoryId,
    isSearchOpen,
    // Data
    results,
    total,
    categories,
    projects,
    // Loading
    isSearching: isSearching || isFetching,
    isQueryValid,
    // Actions
    handleSearchQueryChange,
    handleProjectChange,
    handleCategoryChange,
    openSearch,
    closeSearch,
  };
};
