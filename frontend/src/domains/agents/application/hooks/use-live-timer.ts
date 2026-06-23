"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Returns a `currentTime` (Date.now()) that auto-updates every second
 * while `enabled` is true. Stops the interval when disabled to avoid
 * unnecessary re-renders.
 */
export const useLiveTimer = (enabled: boolean): number => {
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (enabled) {
      intervalRef.current = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1_000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled]);

  return currentTime;
};
