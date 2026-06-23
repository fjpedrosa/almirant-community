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
