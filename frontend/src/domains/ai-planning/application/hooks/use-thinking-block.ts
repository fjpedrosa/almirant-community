import { useState, useCallback } from "react";

/**
 * Manages collapse state for ThinkingBlock components.
 * Each thinking block is identified by a unique ID (typically the message ID).
 */
export function useThinkingBlock() {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const isCollapsed = useCallback(
    (id: string) => collapsedIds.has(id),
    [collapsedIds],
  );

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return { isCollapsed, toggleCollapse };
}
