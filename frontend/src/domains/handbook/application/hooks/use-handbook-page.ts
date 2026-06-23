"use client";

import { useMemo, useState } from "react";
import {
  useApproveHandbookProposal,
  useHandbookCategories,
  useHandbookEntries,
  useHandbookProposals,
  useHandbookSearch,
  useImportDefaultHandbook,
  useRejectHandbookProposal,
} from "./use-handbook";
import type { HandbookEntry, HandbookPageState } from "../../domain/types";

export const useHandbookPage = (): HandbookPageState => {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedEntry, setSelectedEntry] = useState<HandbookEntry | null>(null);

  const params = useMemo(() => {
    const next = new URLSearchParams();
    next.set("limit", "100");
    if (selectedCategory !== "all") next.set("category", selectedCategory);
    if (search.trim().length >= 2) next.set("search", search.trim());
    return next;
  }, [search, selectedCategory]);

  const entriesQuery = useHandbookEntries(params);
  const searchQuery = useHandbookSearch(search, selectedCategory);
  const categoriesQuery = useHandbookCategories();
  const proposalsQuery = useHandbookProposals();
  const importMutation = useImportDefaultHandbook();
  const approveMutation = useApproveHandbookProposal();
  const rejectMutation = useRejectHandbookProposal();

  const entries = entriesQuery.data ?? [];

  return {
    entries,
    selectedEntry: selectedEntry ?? entries[0] ?? null,
    searchResults: searchQuery.data ?? [],
    proposals: proposalsQuery.data ?? [],
    categories: categoriesQuery.data ?? [],
    search,
    selectedCategory,
    isLoading: entriesQuery.isLoading,
    isImporting: importMutation.isPending,
    isSearching: searchQuery.isFetching,
    onSearchChange: setSearch,
    onCategoryChange: setSelectedCategory,
    onSelectEntry: setSelectedEntry,
    onImportDefault: () => importMutation.mutate(),
    onApproveProposal: (id) => approveMutation.mutate(id),
    onRejectProposal: (id) => rejectMutation.mutate(id),
  };
};
