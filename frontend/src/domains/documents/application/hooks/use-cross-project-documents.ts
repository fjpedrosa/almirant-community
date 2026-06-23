"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { documentsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { useDocumentCategories } from "./use-document-categories";
import { documentKeys } from "./use-documents";
import type {
  CrossProjectDocumentGroup,
  CrossProjectDocumentItem,
  DocumentCategoryWithCount,
} from "../../domain/types";

const RECENT_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

const countRecentDocs = (documents: CrossProjectDocumentItem[]): number => {
  const threshold = new Date(Date.now() - RECENT_THRESHOLD_MS);
  return documents.filter(
    (doc) => new Date(doc.updatedAt) >= threshold
  ).length;
};

export const crossProjectKeys = {
  all: [...documentKeys.all, "cross-project"] as const,
  list: (filters: string) => [...crossProjectKeys.all, filters] as const,
};

const useCrossProjectDocumentsQuery = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(crossProjectKeys.list(params?.toString() || ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      documentsApi.crossProject(params) as Promise<CrossProjectDocumentGroup[]>,
    placeholderData: keepPreviousData,
  });
};

export const useCrossProjectDocuments = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["__knowhow__"])
  );

  // Build query params
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (searchQuery) p.set("search", searchQuery);
    if (activeCategoryId) p.set("categoryId", activeCategoryId);
    return p;
  }, [searchQuery, activeCategoryId]);

  // Data queries
  const { data: groups, isLoading: isLoadingGroups } =
    useCrossProjectDocumentsQuery(params);
  const { data: categories, isLoading: isLoadingCategories } =
    useDocumentCategories();

  const handleToggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const handleCategoryChange = useCallback(
    (categoryId: string | null) => {
      setActiveCategoryId(categoryId);
    },
    []
  );

  // Enrich groups with recentCount
  const enrichedGroups = useMemo(() => {
    const rawGroups = (groups as CrossProjectDocumentGroup[]) || [];
    return rawGroups.map((group) => ({
      ...group,
      recentCount: countRecentDocs(group.documents),
    }));
  }, [groups]);

  return {
    // Data
    groups: enrichedGroups,
    categories: (categories as DocumentCategoryWithCount[]) || [],
    // State
    searchQuery,
    activeCategoryId,
    expandedGroups,
    // Loading
    isLoading: isLoadingGroups || isLoadingCategories,
    // Actions
    setSearchQuery,
    handleCategoryChange,
    handleToggleGroup,
  };
};
