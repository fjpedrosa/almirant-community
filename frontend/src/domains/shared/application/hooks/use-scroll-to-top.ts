"use client";

import { useCallback } from "react";

/**
 * Returns a function that scrolls the nearest list-page-shell content area to the top.
 * Falls back to the main element if no shell is found.
 */
export const useScrollToTop = () => {
  const scrollToTop = useCallback(() => {
    // Try the shell's scrollable area first (from ListPageShell)
    const shellContent = document.querySelector('[data-testid="list-page-shell-content"]');
    if (shellContent) {
      shellContent.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    // Fallback: the <main> element in the dashboard layout
    const main = document.querySelector("main");
    if (main) {
      main.scrollTo({ top: 0, behavior: "instant" });
    }
  }, []);

  return { scrollToTop };
};
