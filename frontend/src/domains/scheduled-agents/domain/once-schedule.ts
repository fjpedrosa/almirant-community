/**
 * Pure helpers for the "once" (run-once) schedule type (scheduleType='once').
 *
 * The backend persists `scheduleConfig.runAt` as an absolute RFC3339/ISO-8601
 * instant (see `onceConfigSchema` in
 * backend/api/src/domains/agents/routes/scheduled-agents.routes.ts). The
 * wizard lets the user pick a *local wall-clock* date/time in the agent's
 * configured IANA timezone (the same `timezone` field cron/time_window
 * already use) via an HTML `datetime-local` input, which carries no timezone
 * information of its own. These helpers convert between that zone-naive
 * wall-clock string and the absolute UTC instant the backend expects,
 * without pulling in a timezone library (date-fns-tz/luxon are not
 * dependencies of this app).
 */

const DATE_TIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

interface DateTimeLocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const parseDateTimeLocal = (value: string): DateTimeLocalParts | null => {
  const match = DATE_TIME_LOCAL_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: second ? Number(second) : 0,
  };
};

/** UTC offset (in minutes, positive = ahead of UTC) that `timeZone` applies at `instant`. */
const getTimeZoneOffsetMinutes = (instant: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const lookup = Object.fromEntries(
    formatter.formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    // Some ICU implementations render midnight as "24" under hourCycle h23;
    // normalize it back to 0 rather than mis-parsing it as hour 24.
    lookup.hour === "24" ? 0 : Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  );
  return (asUtc - instant.getTime()) / 60_000;
};

/**
 * Converts a zone-naive `datetime-local` value (e.g. "2026-08-15T14:30")
 * representing a wall-clock moment IN `timeZone` into an absolute UTC
 * ISO-8601 string. Returns null when `value` doesn't match the expected
 * `datetime-local` shape.
 */
export const zonedDateTimeToIso = (value: string, timeZone: string): string | null => {
  const parts = parseDateTimeLocal(value);
  if (!parts) return null;

  // First guess: treat the wall-clock digits as if they were already UTC,
  // then correct by the zone's actual offset at that instant (DST-aware).
  const naiveUtcGuess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(naiveUtcGuess, timeZone);
  return new Date(naiveUtcGuess.getTime() - offsetMinutes * 60_000).toISOString();
};

/**
 * Inverse of `zonedDateTimeToIso`: given an absolute ISO-8601 instant,
 * returns the `datetime-local`-shaped wall-clock string for that instant in
 * `timeZone`. Returns null when `iso` doesn't parse to a valid date.
 */
export const isoToZonedDateTimeLocal = (iso: string, timeZone: string): string | null => {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const lookup = Object.fromEntries(
    formatter.formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const hour = lookup.hour === "24" ? "00" : lookup.hour;
  return `${lookup.year}-${lookup.month}-${lookup.day}T${hour}:${lookup.minute}`;
};

/**
 * True when the `datetime-local` wall-clock `value` — interpreted in
 * `timeZone` — is already in the past relative to `now`. Used to surface a
 * non-blocking warning ("this will dispatch on the next tick") rather than a
 * validation error: the backend explicitly allows a past `runAt`.
 */
export const isZonedDateTimeInPast = (
  value: string | null | undefined,
  timeZone: string,
  now: Date = new Date(),
): boolean => {
  if (!value) return false;
  const iso = zonedDateTimeToIso(value, timeZone);
  if (!iso) return false;
  return new Date(iso).getTime() < now.getTime();
};
