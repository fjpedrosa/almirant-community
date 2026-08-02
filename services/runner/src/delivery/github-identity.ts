/**
 * GitHub App bot identity for commits made by the runner.
 *
 * The email format for a GitHub App bot is:
 * {app-user-id}+{bot-login}@users.noreply.github.com
 *
 * ID 263330516 verified via GET https://api.github.com/users/almirant-ai%5Bbot%5D
 */
export const GITHUB_BOT_NAME = "almirant-ai[bot]";
export const GITHUB_BOT_EMAIL = "263330516+almirant-ai[bot]@users.noreply.github.com";

/** A Git commit author/committer identity: display name plus attribution email. */
export interface GitCommitIdentity {
  name: string;
  email: string;
}

/**
 * Server-resolved Git identity boundary for commits the runner makes on
 * behalf of a job.
 *
 * `trustedSiteBuild` distinguishes a trusted-delivery execution path (a
 * server-owned author identity applied without accepting agent-controlled
 * Git configuration) from the default bot identity every ordinary job uses.
 * Community has no trusted-delivery workflow yet, so `resolveDeliveryGitIdentity`
 * always yields the `false` branch below — this is the seam a future
 * trusted-delivery feature plugs into without another change to
 * config-injector, container-spec-builder or the entrypoints.
 */
export type DeliveryGitIdentity = {
  trustedSiteBuild: false;
  runnerDeliveryEnabled: false;
  identity: GitCommitIdentity;
};

export const resolveDeliveryGitIdentity = (
  _config: Record<string, unknown>,
): DeliveryGitIdentity => ({
  trustedSiteBuild: false,
  runnerDeliveryEnabled: false,
  identity: { name: GITHUB_BOT_NAME, email: GITHUB_BOT_EMAIL },
});
