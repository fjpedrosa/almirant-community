"use client";

import { useSyncExternalStore, useCallback, useRef, useEffect } from "react";
import { formatDuration } from "../../domain/formatters";

interface ResetTimerResult {
  formattedTimeLeft: string;
  isExpired: boolean;
}

const EXPIRED_RESULT: ResetTimerResult = {
  formattedTimeLeft: "",
  isExpired: true,
};

const computeCountdown = (resetAt: string | null): ResetTimerResult => {
  if (!resetAt) {
    return EXPIRED_RESULT;
  }

  const now = Date.now();
  const target = new Date(resetAt).getTime();
  const diff = target - now;

  if (diff <= 0) {
    return EXPIRED_RESULT;
  }

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let formattedTimeLeft: string;

  if (hours > 0) {
    formattedTimeLeft = formatDuration(totalSeconds / 3600);
  } else if (minutes > 0) {
    formattedTimeLeft = `${minutes}m ${seconds}s`;
  } else {
    formattedTimeLeft = `${seconds}s`;
  }

  return { formattedTimeLeft, isExpired: false };
};

export const useResetTimer = (resetAt: string | null): ResetTimerResult => {
  const listenersRef = useRef(new Set<() => void>());
  const snapshotRef = useRef<ResetTimerResult>(computeCountdown(resetAt));

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  useEffect(() => {
    snapshotRef.current = computeCountdown(resetAt);
    listenersRef.current.forEach((l) => l());

    if (!resetAt) {
      return;
    }

    const interval = setInterval(() => {
      const next = computeCountdown(resetAt);
      snapshotRef.current = next;
      listenersRef.current.forEach((l) => l());

      if (next.isExpired) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [resetAt]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
