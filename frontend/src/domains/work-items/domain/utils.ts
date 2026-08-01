import type { TShirtSize } from "./types";

/**
 * Convert story points to a t-shirt size.
 * Ranges: 1-2=XS, 3-4=S, 5-7=M, 8-13=L, 14-34=XL, 35+=XXL
 *
 * @param points - The story points value
 * @returns The t-shirt size, or null for points <= 0
 */
export const pointsToTShirtSize = (points: number): TShirtSize | null => {
  if (points <= 0) return null;
  if (points <= 2) return "XS";
  if (points <= 4) return "S";
  if (points <= 7) return "M";
  if (points <= 13) return "L";
  if (points <= 34) return "XL";
  return "XXL";
};

/**
 * Map an optional form `Date` (e.g. `startDate`, `dueDate`) to the
 * `string | null` shape the create/update work item requests expect.
 * `undefined` (never set / cleared) becomes `null` so the field can be
 * explicitly unset server-side instead of being silently ignored.
 */
export const toOptionalIsoString = (date: Date | undefined): string | null =>
  date ? date.toISOString() : null;

/**
 * Map a persisted date value (as it comes back from the API — a `Date`,
 * an ISO string, or `null`) to the optional `Date` the work item form uses.
 */
export const toOptionalFormDate = (
  value: Date | string | null | undefined
): Date | undefined => (value ? new Date(value) : undefined);

/**
 * Whether a persisted date value is set AND strictly after `now`.
 *
 * Drives the "Scheduled" badge on the board card and detail panel: it must
 * mirror the backend gate `isScheduledForLater` in
 * `backend/packages/database/src/repositories/agents/backlog-drain-selection.ts`
 * (issue #47) exactly, so the badge only shows while the backlog drain is
 * actually still skipping the item. A null/undefined value, an unparsable
 * string, or a date already in the past all resolve to `false` — same as
 * the backend's "immediately eligible" treatment of those cases.
 */
export const isFutureDate = (
  value: Date | string | null | undefined,
  now: Date = new Date()
): boolean => {
  if (value === null || value === undefined) return false;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) && time > now.getTime();
};

/**
 * Whether `isFutureDate(startDate, now)` could have flipped between
 * `prevNow` and `nextNow`.
 *
 * Drives `WorkItemCard`'s memo comparator: the board ticks `now` every 60s
 * (`use-minute-now.ts`) so the "Scheduled" badge stops going stale once its
 * startDate passes an open tab. But most cards have no `startDate` at all —
 * re-rendering every one of them on every tick would defeat memoization for
 * no visual benefit. This predicate lets the comparator bail out of
 * memoization ONLY for the cards where the tick actually matters.
 */
export const scheduledVisibilityChanged = (
  startDate: Date | string | null | undefined,
  prevNow: Date,
  nextNow: Date
): boolean => isFutureDate(startDate, prevNow) !== isFutureDate(startDate, nextNow);
