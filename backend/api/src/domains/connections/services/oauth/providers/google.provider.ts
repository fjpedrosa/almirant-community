import type { OAuthProviderConfig } from "../types";

/**
 * Google Gemini OAuth provider.
 *
 * Not yet supported via our OAuth flow. Google Gemini CLI uses embedded
 * client credentials that are not publicly documented. Connections with
 * Google OAuth tokens (imported from ~/.gemini/oauth_creds.json) can
 * still use the quota API for usage fetching.
 */
export const getGoogleOAuthConfig = (): OAuthProviderConfig | null => {
  return null;
};
