/**
 * Deployment mode helper.
 *
 * Almirant ships in two shapes:
 *  - self-hosted (Community Edition): the operator runs the whole stack on their
 *    own machine/VM. Onboarding walks them through the admin account, the public
 *    URL (Tailscale) and the GitHub App.
 *  - cloud (cloud.almirant.ai): Almirant hosts the instance. The admin account
 *    and the public URL are provisioned by the platform, so onboarding only
 *    needs the GitHub App step.
 *
 * The mode is selected at build time via the public env var
 * `NEXT_PUBLIC_IS_CLOUD`. Fail-safe: anything other than the exact string
 * `"true"` (including an unset var) means self-hosted, so the current CE
 * behavior is preserved by default.
 */

export interface DeploymentEnv {
  NEXT_PUBLIC_IS_CLOUD?: string;
}

/** Pure, injectable core so the decision can be unit-tested without touching `process.env`. */
export const isCloudDeploymentFromEnv = (env: DeploymentEnv): boolean =>
  env.NEXT_PUBLIC_IS_CLOUD === "true";

/**
 * Whether this build targets the hosted cloud edition.
 *
 * NOTE: `process.env.NEXT_PUBLIC_IS_CLOUD` MUST be referenced statically (never
 * via a computed key) so Next.js inlines it into the client bundle at build
 * time. Reads identically during SSR (server components) and on the client.
 */
export const isCloudDeployment = (): boolean =>
  isCloudDeploymentFromEnv({
    NEXT_PUBLIC_IS_CLOUD: process.env.NEXT_PUBLIC_IS_CLOUD,
  });
