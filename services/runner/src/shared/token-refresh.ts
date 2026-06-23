/** Interval in ms between token refreshes (25 minutes — well before the 1h GitHub App token expiry). */
export const TOKEN_REFRESH_INTERVAL_MS = 25 * 60 * 1000;

/**
 * Build the git credential-helper script content.
 * Written to `/tmp/git-credential-almirant.sh` inside the container.
 */
export const buildCredentialHelperScript = (token: string): string => {
  const escaped = token.replace(/"/g, '\\"');
  return [
    "#!/bin/sh",
    'echo "username=x-access-token"',
    `echo "password=${escaped}"`,
    "",
  ].join("\n");
};

/**
 * Build the GIT_ASKPASS script content.
 * Written to `/tmp/git-askpass.sh` inside the container.
 */
export const buildAskpassScript = (token: string): string => {
  const escaped = token.replace(/"/g, '\\"');
  return ["#!/bin/sh", `echo "${escaped}"`, ""].join("\n");
};

/**
 * Determine whether the GitHub token inside the container should be refreshed.
 * Returns `true` when enough time has passed since the last refresh.
 */
export const shouldRefreshToken = (lastRefreshMs: number): boolean => {
  if (lastRefreshMs === 0) return true;
  return Date.now() - lastRefreshMs >= TOKEN_REFRESH_INTERVAL_MS;
};
