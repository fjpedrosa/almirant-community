/**
 * Pure functions for container lifecycle decisions.
 *
 * Determines whether to attempt workspace archive extraction
 * based on container state and session outcome.
 */

export interface ArchiveStrategyInput {
  containerId: string | undefined;
  containerRunning: boolean;
  sessionSuccess: boolean;
  repoUrl: string | undefined;
}

export type ArchiveStrategy = "extract" | "skip";

/**
 * Determine whether to attempt workspace archive extraction.
 * Returns "skip" if the container is dead or session failed.
 */
export const determineArchiveStrategy = (input: ArchiveStrategyInput): ArchiveStrategy => {
  if (!input.containerId) return "skip";
  if (!input.repoUrl) return "skip";
  if (!input.sessionSuccess) return "skip";
  if (!input.containerRunning) return "skip";
  return "extract";
};
