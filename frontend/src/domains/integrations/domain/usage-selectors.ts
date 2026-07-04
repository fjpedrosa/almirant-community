import type { ConnectionUsageData, UsageSummaryResponseItem } from "./types";

/**
 * Picks a single connection's usage out of the already-batched usage summary
 * (`GET /connections/usage-summary`).
 *
 * Lets every API-key row read from ONE shared summary query (deduped by React
 * Query on the summary key) instead of each firing its own
 * `GET /connections/:id/usage` on a 5-minute poll (the old N+1).
 */
export const selectConnectionUsage = (
  items: UsageSummaryResponseItem[] | undefined,
  connectionId: string,
): ConnectionUsageData | null => {
  if (!items || !connectionId) return null;
  return items.find((item) => item.connectionId === connectionId)?.usage ?? null;
};
