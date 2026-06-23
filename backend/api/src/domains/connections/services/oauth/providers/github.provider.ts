import { env } from "@almirant/config";
import { getGithubAppCredentials } from "../../../../instance/services/github-app-credentials-service";
import type { OAuthProviderConfig } from "../types";

/**
 * Returns the GitHub OAuth config for user-level OAuth flows.
 * Reads clientId / clientSecret from the DB-stored GitHub App credentials first,
 * then falls back to env vars.
 */
export const getGitHubOAuthConfig =
  async (): Promise<OAuthProviderConfig | null> => {
    const result = await getGithubAppCredentials();
    const clientId = result?.credentials.clientId ?? env.GITHUB_CLIENT_ID;
    const clientSecret =
      result?.credentials.clientSecret ?? env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return null;
    }

    return {
      name: "github",
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      redirectUri: env.GITHUB_OAUTH_REDIRECT_URI ?? "",
      clientId,
      clientSecret,
      scopes: "repo user:email",
      usePKCE: false,
      manualCodeEntry: false,
      extraAuthParams: {},
      tokenRequestHeaders: {
        Accept: "application/json",
      },
      authMode: "bearer",
    };
  };
