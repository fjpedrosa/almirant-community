import type { GithubConnectionStatus } from "./types";

/**
 * Whether the GitHub tab's six data hooks (summary, prs, commits, actions,
 * contributors, activity) should fire.
 *
 * A project is only "ready" for these upstream GitHub API calls when the app is
 * configured, has at least one installation, AND has at least one linked repo.
 * Otherwise the six calls are wasted round-trips (they burn the shared GitHub
 * rate-limit for a project that has nothing to show). Status still loading
 * (`undefined`) counts as not-ready.
 */
export const githubHooksEnabled = (
  projectId: string,
  status: GithubConnectionStatus | undefined,
): boolean => {
  if (!projectId) return false;
  if (!status) return false;
  return (
    status.configured &&
    status.installations.length > 0 &&
    status.linkedRepos.length > 0
  );
};
