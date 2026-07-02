import type { AuthProviderRegistry, AuthProviderDescriptor } from "@almirant/shared";
import { env } from "@almirant/config";

/**
 * Default AuthProviderRegistry for the Community Edition.
 *
 * Reads configured OAuth providers from env vars. CE supports:
 * - Email/password (always available for self-hosted bootstrap + login)
 * - Google OAuth (if GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set)
 * - GitHub OAuth (if GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET are set)
 *
 * Enterprise Edition can inject a richer registry that includes SAML/OIDC
 * providers configured per-workspace.
 */
function buildDescriptors(): AuthProviderDescriptor[] {
  const list: AuthProviderDescriptor[] = [
    {
      id: "email-password",
      displayName: "Email & password",
      type: "credentials",
    },
  ];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    list.push({ id: "google", displayName: "Google", type: "oauth" });
  }

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    list.push({ id: "github", displayName: "GitHub", type: "oauth" });
  }

  return list;
}

export const defaultAuthProviderRegistry: AuthProviderRegistry = (() => {
  const providers = buildDescriptors();
  return {
    list: () => providers,
    has: (id: string) => providers.some((p) => p.id === id),
  };
})();
