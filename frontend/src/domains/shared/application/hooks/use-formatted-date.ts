"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import {
  format,
  formatDistanceToNow,
  type Locale as DateFnsLocale,
} from "date-fns";
import { es, enUS } from "date-fns/locale";

type DateInput = Date | string | number;

const dateFnsLocales: Record<string, DateFnsLocale> = {
  es,
  en: enUS,
};

const getDateFnsLocale = (locale: string): DateFnsLocale => {
  return dateFnsLocales[locale] ?? enUS;
};

const toDate = (input: DateInput): Date => {
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  return new Date(input);
};

/**
 * Hook for formatting dates with automatic locale support.
 *
 * Uses next-intl's useLocale() to get the current user locale and
 * applies the corresponding date-fns locale for localized formatting.
 *
 * @example
 * ```tsx
 * const { formatRelative, formatShort, formatLong, formatDateTime, formatTime } = useFormattedDate();
 *
 * return (
 *   <div>
 *     <span>{formatRelative(createdAt)}</span>
 *     <span>{formatShort(dueDate)}</span>
 *   </div>
 * );
 * ```
 */
const useFormattedDate = () => {
  const locale = useLocale();
  const dateFnsLocale = useMemo(() => getDateFnsLocale(locale), [locale]);

  const formatRelative = useMemo(
    () => (date: DateInput): string => {
      const d = toDate(date);
      return formatDistanceToNow(d, {
        addSuffix: true,
        locale: dateFnsLocale,
      });
    },
    [dateFnsLocale]
  );

  const formatShort = useMemo(
    () => (date: DateInput): string => {
      const d = toDate(date);
      // English: "Feb 28, 2026" | Spanish: "28 feb 2026"
      return format(d, "PP", { locale: dateFnsLocale });
    },
    [dateFnsLocale]
  );

  const formatLong = useMemo(
    () => (date: DateInput): string => {
      const d = toDate(date);
      // English: "February 28, 2026" | Spanish: "28 de febrero de 2026"
      return format(d, "PPP", { locale: dateFnsLocale });
    },
    [dateFnsLocale]
  );

  const formatDateTime = useMemo(
    () => (date: DateInput): string => {
      const d = toDate(date);
      // English: "Feb 28, 2026 3:45 PM" | Spanish: "28 feb 2026 15:45"
      return format(d, "PPp", { locale: dateFnsLocale });
    },
    [dateFnsLocale]
  );

  const formatTime = useMemo(
    () => (date: DateInput): string => {
      const d = toDate(date);
      // English: "3:45 PM" | Spanish: "15:45"
      return format(d, "p", { locale: dateFnsLocale });
    },
    [dateFnsLocale]
  );

  return {
    /** Format as relative time, e.g., "2 hours ago" / "hace 2 horas" */
    formatRelative,
    /** Format as short date, e.g., "Feb 28, 2026" / "28 feb 2026" */
    formatShort,
    /** Format as long date, e.g., "February 28, 2026" / "28 de febrero de 2026" */
    formatLong,
    /** Format as date and time, e.g., "Feb 28, 2026 3:45 PM" / "28 feb 2026 15:45" */
    formatDateTime,
    /** Format as time only, e.g., "3:45 PM" / "15:45" */
    formatTime,
    /** Raw date-fns locale object for use with Calendar and other date-fns functions */
    locale: dateFnsLocale,
  };
};

export default useFormattedDate;
