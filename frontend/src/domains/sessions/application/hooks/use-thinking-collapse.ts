"use client";

import { useState, useCallback, useMemo } from "react";
import type { TranscriptSegment } from "../../domain/types";

export const useThinkingCollapse = (segments?: TranscriptSegment[]) => {
  const [allCollapsed, setAllCollapsed] = useState(true);
  const [overrides, setOverrides] = useState<Set<number>>(new Set());

  const hasThinkingBlocks = useMemo(
    () => segments?.some((s) => s.contentType === "thinking") ?? false,
    [segments],
  );

  const toggleAll = useCallback(() => {
    setAllCollapsed((prev) => !prev);
    setOverrides(new Set());
  }, []);

  const toggleOne = useCallback((index: number) => {
    setOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const isOpen = useCallback(
    (index: number): boolean => {
      const globalOpen = !allCollapsed;
      const hasOverride = overrides.has(index);
      return hasOverride ? !globalOpen : globalOpen;
    },
    [allCollapsed, overrides],
  );

  return {
    allCollapsed,
    hasThinkingBlocks,
    toggleAll,
    isOpen,
    toggleOne,
  };
};
