"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Hook: useTypewriter
// ---------------------------------------------------------------------------
// Buffers content and reveals it character-by-character for a typewriter effect.
// Snaps to word boundaries to avoid cutting mid-word (prevents markdown
// artifacts like "**bol").
//
// @param targetContent - The full content to reveal (grows as SSE chunks arrive)
// @param isActive - Whether the typewriter effect is active (true during streaming)
// @param charsPerTick - Characters to reveal per tick (default: 4)
// @returns { content: revealed substring, isRevealing: true while buffer has unrevealed chars }
// ---------------------------------------------------------------------------

export const useTypewriter = (
  targetContent: string,
  isActive: boolean,
  charsPerTick = 4,
) => {
  const [revealedLength, setRevealedLength] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetLengthRef = useRef(0);
  const targetContentRef = useRef(targetContent);
  const wasActiveRef = useRef(isActive);
  const prevContentLengthRef = useRef(targetContent.length);

  // Keep refs in sync via effect (not during render)
  useEffect(() => {
    targetLengthRef.current = targetContent.length;
    targetContentRef.current = targetContent;
  }, [targetContent]);

  // Memoized tick function to advance revealed length
  const tick = useCallback(() => {
    setRevealedLength((prev) => {
      const target = targetLengthRef.current;
      const currentContent = targetContentRef.current;
      if (prev >= target) return prev; // Nothing to reveal, wait for more content

      // Advance by charsPerTick
      let next = Math.min(prev + charsPerTick, target);

      // Snap to next word boundary (space, newline, or end of content)
      // to avoid cutting mid-word which causes markdown artifacts
      if (next < target) {
        const nextSpace = currentContent.indexOf(" ", next);
        const nextNewline = currentContent.indexOf("\n", next);
        const boundaries = [nextSpace, nextNewline].filter((i) => i !== -1);
        if (boundaries.length > 0) {
          next = Math.min(...boundaries) + 1;
        } else {
          next = target; // No more boundaries, reveal all remaining
        }
      }

      return Math.min(next, target);
    });
  }, [charsPerTick]);

  // Start/stop the reveal interval based on isActive
  useEffect(() => {
    // Handle transition from active to inactive
    if (wasActiveRef.current && !isActive) {
      // Stop the interval and sync revealedLength when streaming ends
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setRevealedLength(targetLengthRef.current);
    }

    wasActiveRef.current = isActive;

    if (!isActive) return;

    // Don't start a new interval if one is already running
    if (intervalRef.current) return;

    intervalRef.current = setInterval(tick, 20); // 20ms = ~50 ticks/sec

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, tick]);

  // Handle content reset (new message)
  useEffect(() => {
    // If content was cleared (went to 0), reset revealed length
    if (prevContentLengthRef.current > 0 && targetContent.length === 0) {
      // Use setTimeout to avoid synchronous setState in effect
      setTimeout(() => setRevealedLength(0), 0);
    }
    prevContentLengthRef.current = targetContent.length;
  }, [targetContent.length]);

  // When not active, show full content immediately
  // When active, show only the revealed portion
  const content = isActive
    ? targetContent.slice(0, revealedLength)
    : targetContent;

  const isRevealing = isActive && revealedLength < targetContent.length;

  return { content, isRevealing };
};
