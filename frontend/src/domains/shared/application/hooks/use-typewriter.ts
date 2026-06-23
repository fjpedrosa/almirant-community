"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export const useTypewriter = (
  targetContent: string,
  isActive: boolean,
  charsPerTick = 4,
) => {
  // Lazy init: when the hook mounts on already-accumulated content (e.g. user
  // reopens a still-active session whose last assistant block already holds
  // thousands of characters), start with everything revealed so we don't
  // rebobinate the whole transcript. Only future deltas should be animated.
  const [revealedLength, setRevealedLength] = useState(() =>
    isActive ? targetContent.length : 0,
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetLengthRef = useRef(targetContent.length);
  const targetContentRef = useRef(targetContent);
  const wasActiveRef = useRef(isActive);
  const prevContentLengthRef = useRef(targetContent.length);

  useEffect(() => {
    targetLengthRef.current = targetContent.length;
    targetContentRef.current = targetContent;
  }, [targetContent]);

  const tick = useCallback(() => {
    setRevealedLength((prev) => {
      const target = targetLengthRef.current;
      const currentContent = targetContentRef.current;
      if (prev >= target) return prev;

      let next = Math.min(prev + charsPerTick, target);

      if (next < target) {
        const nextSpace = currentContent.indexOf(" ", next);
        const nextNewline = currentContent.indexOf("\n", next);
        const boundaries = [nextSpace, nextNewline].filter((i) => i !== -1);
        if (boundaries.length > 0) {
          next = Math.min(...boundaries) + 1;
        } else {
          next = target;
        }
      }

      return Math.min(next, target);
    });
  }, [charsPerTick]);

  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setRevealedLength(targetLengthRef.current);
    }

    // Transición false → true mid-vida: si llegamos con contenido pre-existente
    // sin revelar (caso típico de rehidratación tardía), saltamos al final
    // antes de empezar a animar para que solo se animen los deltas futuros.
    if (!wasActiveRef.current && isActive) {
      setRevealedLength((prev) =>
        prev === 0 && targetLengthRef.current > 0
          ? targetLengthRef.current
          : prev,
      );
    }

    wasActiveRef.current = isActive;

    if (!isActive || intervalRef.current) return;

    intervalRef.current = setInterval(tick, 20);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, tick]);

  useEffect(() => {
    if (prevContentLengthRef.current > 0 && targetContent.length === 0) {
      setTimeout(() => setRevealedLength(0), 0);
    }
    prevContentLengthRef.current = targetContent.length;
  }, [targetContent.length]);

  const content = isActive
    ? targetContent.slice(0, revealedLength)
    : targetContent;

  const isRevealing = isActive && revealedLength < targetContent.length;

  return { content, isRevealing };
};
