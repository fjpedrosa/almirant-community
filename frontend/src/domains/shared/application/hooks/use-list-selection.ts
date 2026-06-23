"use client";

import { useState, useCallback, useRef } from "react";

/**
 * Generic list selection hook for multi-select functionality.
 * Supports toggle, range select (shift+click), select all, and clear.
 *
 * Used by Todos, Seeds, and Ideas list views for bulk actions.
 */
export const useListSelection = <T extends string = string>() => {
  const [selectedIds, setSelectedIds] = useState<Set<T>>(new Set());
  const lastSelectedRef = useRef<T | null>(null);

  const toggleSelect = useCallback((itemId: T) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
    lastSelectedRef.current = itemId;
  }, []);

  const rangeSelect = useCallback(
    (itemId: T, allItemIds: T[]) => {
      const anchorId = lastSelectedRef.current;
      if (!anchorId) {
        toggleSelect(itemId);
        return;
      }

      const anchorIndex = allItemIds.indexOf(anchorId);
      const targetIndex = allItemIds.indexOf(itemId);

      if (anchorIndex === -1 || targetIndex === -1) {
        toggleSelect(itemId);
        return;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const rangeIds = allItemIds.slice(start, end + 1);

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of rangeIds) {
          next.add(id);
        }
        return next;
      });
    },
    [toggleSelect],
  );

  const selectAll = useCallback((allItemIds: T[]) => {
    setSelectedIds(new Set(allItemIds));
    lastSelectedRef.current = allItemIds[allItemIds.length - 1] ?? null;
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedRef.current = null;
  }, []);

  const isSelected = useCallback(
    (itemId: T) => selectedIds.has(itemId),
    [selectedIds],
  );

  const isSelectionMode = selectedIds.size > 0;
  const selectedCount = selectedIds.size;
  const selectedIdsArray = Array.from(selectedIds);

  return {
    selectedIds,
    selectedIdsArray,
    selectedCount,
    isSelectionMode,
    isSelected,
    toggleSelect,
    rangeSelect,
    selectAll,
    clearSelection,
  };
};
