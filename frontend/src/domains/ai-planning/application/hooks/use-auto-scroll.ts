"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Hook: useAutoScroll
// ---------------------------------------------------------------------------
// Scrolls to the bottom of a container whenever dependencies change,
// BUT only if the user hasn't scrolled up. If the user scrolls up,
// auto-scroll pauses and a "go to bottom" button is shown.
//
// Returns scrollRef (callback ref for the scrollable container) and
// bottomRef (put on a sentinel div at the end of content).
// ---------------------------------------------------------------------------

const NEAR_BOTTOM_THRESHOLD = 150;

export const useAutoScroll = (deps: unknown[], resetKey?: unknown) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);
  const isProgrammaticRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Callback ref: attaches scroll listener + ResizeObserver when the DOM
  // element mounts, cleans up when it unmounts.
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup previous listeners
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    containerRef.current = node;
    if (!node) return;

    const handleScroll = () => {
      if (isProgrammaticRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = node;
      const nearBottom =
        scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_THRESHOLD;

      // Only act if there's actually scrollable content
      const isScrollable = node.scrollHeight > node.clientHeight + 10;

      if (nearBottom || !isScrollable) {
        if (userScrolledUpRef.current) {
          userScrolledUpRef.current = false;
          setShowScrollToBottom(false);
        }
      } else if (!userScrolledUpRef.current) {
        userScrolledUpRef.current = true;
        setShowScrollToBottom(true);
      }
    };

    node.addEventListener("scroll", handleScroll, { passive: true });

    // ResizeObserver: pin scroll to bottom on every content size change.
    // Fires synchronously with layout (same frame as DOM mutation), so it
    // keeps up with fast streaming content that useEffect can't match.
    let resizeObserver: ResizeObserver | null = null;
    const contentEl = node.firstElementChild;
    if (contentEl) {
      resizeObserver = new ResizeObserver(() => {
        if (userScrolledUpRef.current) return;
        isProgrammaticRef.current = true;
        node.scrollTop = node.scrollHeight;
        requestAnimationFrame(() => {
          isProgrammaticRef.current = false;
        });
      });
      resizeObserver.observe(contentEl);
    }

    cleanupRef.current = () => {
      node.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();
    };
  }, []);

  // Auto-scroll when deps change (only if user hasn't scrolled up)
  useEffect(() => {
    if (userScrolledUpRef.current) return;

    const container = containerRef.current;
    if (!container) return;

    isProgrammaticRef.current = true;
    container.scrollTop = container.scrollHeight;

    requestAnimationFrame(() => {
      isProgrammaticRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Reset scroll state when the session changes (resetKey).
  // Without this, userScrolledUpRef stays true after switching sessions and the
  // new session's messages appear at the scroll position of the previous session.
  useEffect(() => {
    if (resetKey === undefined || resetKey === null) return;

    userScrolledUpRef.current = false;
    setShowScrollToBottom(false);

    const container = containerRef.current;
    if (!container) return;

    isProgrammaticRef.current = true;
    container.scrollTop = container.scrollHeight;
    requestAnimationFrame(() => {
      isProgrammaticRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const scrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    setShowScrollToBottom(false);

    isProgrammaticRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });

    setTimeout(() => {
      isProgrammaticRef.current = false;
    }, 500);
  }, []);

  return { scrollRef, bottomRef, showScrollToBottom, scrollToBottom };
};
