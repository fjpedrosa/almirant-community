"use client";

import { useSyncExternalStore, useCallback, useRef, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { es, enUS, type Locale as DateFnsLocale } from "date-fns/locale";
import { useLocale } from "next-intl";

// ---------------------------------------------------------------------------
// Locale mapping
// ---------------------------------------------------------------------------

const dateFnsLocales: Record<string, DateFnsLocale> = {
  es,
  en: enUS,
};

const getDateFnsLocale = (locale: string): DateFnsLocale => {
  return dateFnsLocales[locale] ?? enUS;
};

// ---------------------------------------------------------------------------
// useRelativeTime - auto-updating relative timestamp
// ---------------------------------------------------------------------------

const UPDATE_INTERVAL_MS = 30_000; // 30 seconds

const computeRelativeTime = (
  timestamp: number | undefined,
  locale: DateFnsLocale
): string => {
  if (!timestamp) {
    return "";
  }

  return formatDistanceToNow(new Date(timestamp), {
    addSuffix: false,
    locale,
  });
};

/**
 * Hook that returns a formatted relative time string (e.g., "2 minutes", "1 hour")
 * that automatically updates every 30 seconds.
 *
 * @param timestamp - Unix timestamp in milliseconds (from React Query's dataUpdatedAt)
 * @returns Formatted relative time string, or empty string if no timestamp
 *
 * @example
 * ```tsx
 * const relativeTime = useRelativeTime(query.dataUpdatedAt);
 * // returns "2 minutes", "less than a minute", "1 hour", etc.
 * ```
 */
export const useRelativeTime = (timestamp: number | undefined): string => {
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);

  const listenersRef = useRef(new Set<() => void>());
  const snapshotRef = useRef<string>(computeRelativeTime(timestamp, dateFnsLocale));

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  useEffect(() => {
    // Update snapshot immediately when timestamp or locale changes
    snapshotRef.current = computeRelativeTime(timestamp, dateFnsLocale);
    listenersRef.current.forEach((l) => l());

    if (!timestamp) {
      return;
    }

    const interval = setInterval(() => {
      const next = computeRelativeTime(timestamp, dateFnsLocale);
      snapshotRef.current = next;
      listenersRef.current.forEach((l) => l());
    }, UPDATE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [timestamp, dateFnsLocale]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};
