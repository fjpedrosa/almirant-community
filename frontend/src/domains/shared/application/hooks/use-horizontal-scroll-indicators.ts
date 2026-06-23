"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface HorizontalScrollIndicators {
  /** Whether the container can scroll left (not at start) */
  canScrollLeft: boolean;
  /** Whether the container can scroll right (not at end) */
  canScrollRight: boolean;
  /** Ref to attach to the scrollable container element */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Callback to update scroll state - call this on scroll events */
  updateScrollState: () => void;
}

/**
 * Hook to track horizontal scroll position and determine if scroll indicators
 * should be shown at the left/right edges of a scrollable container.
 *
 * For use with Radix ScrollArea, attach the scrollRef to the container that wraps
 * the ScrollArea. The hook will find the viewport element via data-slot attribute.
 *
 * @example
 * const { canScrollLeft, canScrollRight, scrollRef, updateScrollState } = useHorizontalScrollIndicators();
 *
 * return (
 *   <div className="relative" ref={scrollRef}>
 *     {canScrollLeft && <div className="absolute left-0 ... gradient" />}
 *     <ScrollArea>
 *       <div onScroll={updateScrollState}>
 *         {content}
 *       </div>
 *     </ScrollArea>
 *     {canScrollRight && <div className="absolute right-0 ... gradient" />}
 *   </div>
 * );
 */
export const useHorizontalScrollIndicators = (): HorizontalScrollIndicators => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const getViewportElement = useCallback((): HTMLElement | null => {
    const container = scrollRef.current;
    if (!container) return null;

    // Try to find Radix ScrollArea viewport
    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]');
    if (viewport instanceof HTMLElement) return viewport;

    // Fall back to the container itself if it's scrollable
    if (container.scrollWidth > container.clientWidth) return container;

    return null;
  }, []);

  const updateScrollState = useCallback(() => {
    const el = getViewportElement();
    if (!el) return;

    const { scrollLeft, scrollWidth, clientWidth } = el;
    // Small threshold to account for subpixel rendering
    const threshold = 2;

    setCanScrollLeft(scrollLeft > threshold);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - threshold);
  }, [getViewportElement]);

  // Initial check, resize observer, and scroll listener
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // Delay to allow DOM to render
    const timeoutId = setTimeout(() => {
      const viewport = getViewportElement();
      if (!viewport) return;

      // Initial state
      updateScrollState();

      // Add scroll listener
      viewport.addEventListener("scroll", updateScrollState, { passive: true });

      // Observe size changes
      const resizeObserver = new ResizeObserver(() => {
        updateScrollState();
      });
      resizeObserver.observe(viewport);

      // Also observe content changes
      const mutationObserver = new MutationObserver(() => {
        updateScrollState();
      });
      mutationObserver.observe(viewport, { childList: true, subtree: true });
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      const viewport = getViewportElement();
      if (viewport) {
        viewport.removeEventListener("scroll", updateScrollState);
      }
    };
  }, [getViewportElement, updateScrollState]);

  return {
    canScrollLeft,
    canScrollRight,
    scrollRef,
    updateScrollState,
  };
};
