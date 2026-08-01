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
