"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const STALE_THRESHOLD_MS = 60_000; // 60 seconds without events
const CHECK_INTERVAL_MS = 10_000; // Check every 10 seconds

export const useStaleSessionDetection = (isSessionActive: boolean) => {
  const [isStale, setIsStale] = useState(false);
  const lastEventTimestampRef = useRef<number>(0);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recordActivity = useCallback(() => {
    lastEventTimestampRef.current = Date.now();
    if (isStale) setIsStale(false);
  }, [isStale]);

  useEffect(() => {
    if (!isSessionActive) {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
      return;
    }

    lastEventTimestampRef.current = Date.now();

    checkIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - lastEventTimestampRef.current;
      if (elapsed >= STALE_THRESHOLD_MS) {
        setIsStale(true);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [isSessionActive]);

  // Derive final stale state: only stale when session is active
  const effectiveIsStale = isSessionActive && isStale;

  return { isStale: effectiveIsStale, recordActivity };
};
