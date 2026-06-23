import { useState, useEffect, useMemo } from "react";

// ---------------------------------------------------------------------------
// Hook: useCountdownTimer
// ---------------------------------------------------------------------------
// Calculates remaining seconds from an ISO `expiresAt` timestamp and returns
// formatted "MM:SS" string plus warning/critical flags.
//
// Usage:
//   const countdown = useCountdownTimer(expiresAt);
//   // countdown.formatted  → "14:32"
//   // countdown.isWarning  → true when < 3 minutes remain
//   // countdown.isCritical → true when < 1 minute remains
//   // countdown.isActive   → true when timer is running (expiresAt is set and not expired)
// ---------------------------------------------------------------------------

const WARNING_THRESHOLD_SECONDS = 180; // 3 minutes
const CRITICAL_THRESHOLD_SECONDS = 60; // 1 minute

export interface CountdownTimerResult {
  /** Seconds remaining (clamped to 0). */
  remainingSeconds: number;
  /** Formatted time string "MM:SS". */
  formatted: string;
  /** True when less than 3 minutes remain. */
  isWarning: boolean;
  /** True when less than 1 minute remains. */
  isCritical: boolean;
  /** True when the timer is actively counting down (expiresAt is set and not yet expired). */
  isActive: boolean;
}

const INACTIVE: CountdownTimerResult = {
  remainingSeconds: 0,
  formatted: "00:00",
  isWarning: false,
  isCritical: false,
  isActive: false,
};

const calcRemaining = (expiresAt: string): number =>
  Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));

const formatTime = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

export const useCountdownTimer = (expiresAt: string | null): CountdownTimerResult => {
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    expiresAt ? calcRemaining(expiresAt) : 0,
  );

  useEffect(() => {
    if (!expiresAt) {
      setRemainingSeconds(0);
      return;
    }

    // Sync immediately when expiresAt changes
    setRemainingSeconds(calcRemaining(expiresAt));

    const interval = setInterval(() => {
      const remaining = calcRemaining(expiresAt);
      setRemainingSeconds(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  return useMemo<CountdownTimerResult>(() => {
    if (!expiresAt || remainingSeconds <= 0) return INACTIVE;

    return {
      remainingSeconds,
      formatted: formatTime(remainingSeconds),
      isWarning: remainingSeconds <= WARNING_THRESHOLD_SECONDS,
      isCritical: remainingSeconds <= CRITICAL_THRESHOLD_SECONDS,
      isActive: true,
    };
  }, [expiresAt, remainingSeconds]);
};
