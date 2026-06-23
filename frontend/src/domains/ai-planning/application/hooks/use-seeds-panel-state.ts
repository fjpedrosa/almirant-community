"use client";

import { useState, useCallback, useMemo } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import {
  useBulkSeedSelection,
  useCreateSeed,
  useSeeds,
} from "@/domains/planning/application/hooks/use-seeds-manager";
import type { SeedWithRelations } from "@/domains/planning/domain/types";

// ---------------------------------------------------------------------------
// Hook: useSeedsPanelState
// ---------------------------------------------------------------------------
// Composes useSeeds, useCreateSeed, and useBulkSeedSelection into a single
// state object for the seeds panel in the AI Planning redesign.
// Adds client-side search filtering and selection management.
// ---------------------------------------------------------------------------

export const useSeedsPanelState = () => {
  // ----- Local state -----
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // ----- Composed hooks -----
  const { data: seeds = [], isLoading } = useSeeds();
  const createSeed = useCreateSeed();
  const bulkSelection = useBulkSeedSelection();

  // ----- Client-side search filter -----
  const filteredSeeds = useMemo<SeedWithRelations[]>(() => {
    if (!searchQuery.trim()) return seeds;

    const query = searchQuery.trim().toLowerCase();
    return seeds.filter((seed) => seed.title.toLowerCase().includes(query));
  }, [seeds, searchQuery]);

  // ----- Stable reference for selectedIds -----
  const stableSelectedIds = useMemo(() => selectedIds, [selectedIds]);

  // ----- Handlers -----
  const handleQuickAdd = useCallback(
    (data: { title: string; description?: string }) => {
      createSeed.mutate(
        { title: data.title, description: data.description, source: "manual" },
        {
          onSuccess: () => {
            showToast.success("Seed creada correctamente");
          },
          onError: () => {
            showToast.error("Error al crear la seed");
          },
        },
      );
    },
    [createSeed],
  );

  const handleToggleSelection = useCallback(
    (id: string, selected: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (selected) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });
    },
    [],
  );

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(filteredSeeds.map((s) => s.id)));
  }, [filteredSeeds]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkAction = useCallback(
    (action: "select_for_planning" | "deselect_from_planning") => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;

      const selected = action === "select_for_planning";
      bulkSelection.mutate(
        { ids, selected },
        {
          onSuccess: (result) => {
            showToast.success(
              `${result.updated} seed${result.updated !== 1 ? "s" : ""} ${selected ? "incluida" : "excluida"}${result.updated !== 1 ? "s" : ""} del planning`,
            );
            setSelectedIds(new Set());
          },
          onError: () => {
            showToast.error("Error al actualizar las seeds");
          },
        },
      );
    },
    [selectedIds, bulkSelection],
  );

  // ----- Return flat object -----
  return {
    // Data
    seeds,
    filteredSeeds,
    isLoading,
    totalCount: seeds.length,
    filteredCount: filteredSeeds.length,

    // Search
    searchQuery,
    setSearchQuery,

    // Selection
    selectedIds: stableSelectedIds,
    selectedCount: stableSelectedIds.size,
    handleToggleSelection,
    handleSelectAll,
    handleDeselectAll,

    // Quick add
    handleQuickAdd,
    isCreating: createSeed.isPending,

    // Bulk actions
    handleBulkAction,
    isBulkUpdating: bulkSelection.isPending,
  };
};
