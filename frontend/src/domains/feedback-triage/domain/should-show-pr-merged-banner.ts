import type { ClusterLastChangeSummary, ClusterStatus } from "./types";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export interface ShouldShowPrMergedBannerArgs {
  lastChange: ClusterLastChangeSummary | null;
  currentStatus: ClusterStatus;
  now: Date;
}

/**
 * Determines whether the "PR mergeado — validación en curso" banner should be
 * shown in the cluster detail hero.
 *
 * The banner is visible for 24h after the PR of the active attempt is merged
 * AND the cluster has transitioned to `resolved`. It communicates to the user
 * that a fix has landed but the validation window is still open.
 */
export const shouldShowPrMergedBanner = ({
  lastChange,
  currentStatus,
  now,
}: ShouldShowPrMergedBannerArgs): boolean => {
  if (!lastChange) return false;
  if (lastChange.reason !== "pr_merged") return false;
  if (currentStatus !== "resolved") return false;
  const changedAtMs = Date.parse(lastChange.changedAt);
  if (Number.isNaN(changedAtMs)) return false;
  const deltaMs = now.getTime() - changedAtMs;
  return deltaMs >= 0 && deltaMs < TWENTY_FOUR_HOURS_MS;
};
