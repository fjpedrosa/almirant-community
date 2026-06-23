"use client";

import { useState, useCallback, useRef } from "react";

export const useBoardSelection = () => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);

  const toggleSelect = useCallback((itemId: string) => {
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
    (itemId: string, columnItemIds: string[]) => {
      const anchorId = lastSelectedRef.current;
      if (!anchorId) {
        // No anchor yet — fallback to toggle (sets anchor)
        toggleSelect(itemId);
        return;
      }

      const anchorIndex = columnItemIds.indexOf(anchorId);
      const targetIndex = columnItemIds.indexOf(itemId);

      if (anchorIndex === -1 || targetIndex === -1) {
        // Anchor not in this column — fallback to toggle
        toggleSelect(itemId);
        return;
      }

      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const rangeIds = columnItemIds.slice(start, end + 1);

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of rangeIds) {
          next.add(id);
        }
        return next;
      });
      // Don't update anchor — keep original for further range selections
    },
    [toggleSelect],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedRef.current = null;
  }, []);

  const isSelectionMode = selectedIds.size > 0;

  return { selectedIds, isSelectionMode, toggleSelect, rangeSelect, clearSelection };
};
