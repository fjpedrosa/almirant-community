"use client";

import { useEffect } from "react";

/**
 * Registers a global keyboard shortcut (Cmd+I on Mac, Ctrl+I on Windows/Linux)
 * that triggers the provided callback. Useful for opening the quick-capture dialog.
 *
 * The listener is cleaned up on unmount.
 */
export const useIdeaShortcut = (onTrigger: () => void) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key === "i") {
        event.preventDefault();
        onTrigger();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onTrigger]);
};
