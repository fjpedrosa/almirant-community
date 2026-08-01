"use client";

import { useEffect, useState } from "react";

/**
 * Tick interval: the "Scheduled" badge only shows a relative label (e.g.
 * "in 3 days"), so second-level precision isn't needed — 60s is frequent
 * enough to catch a startDate passing without re-rendering on every tick.
 */
const TICK_MS = 60_000;

/**
 * Returns the current time, refreshed every `intervalMs` (default 60s).
 *
 * Fixes the "Scheduled" badge going stale (backend gate #47): `ScheduledBadge`
 * evaluates `isFutureDate(startDate, now)` at render time, but `WorkItemCard`
 * is memoized and the board query has a 5-minute `staleTime` — so an open tab
 * with no other state change never re-evaluates the badge once its startDate
 * passes. This hook drives a periodic re-render of whatever consumes it so
 * visibility gets re-checked on a fixed cadence instead of relying on an
 * unrelated refetch or user interaction.
 */
export const useMinuteNow = (intervalMs: number = TICK_MS): Date => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
};
