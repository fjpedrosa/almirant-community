import type { OAuthProviderConfig } from "./types";
import { getAnthropicOAuthConfig, ANTHROPIC_STEALTH_HEADERS } from "./providers/anthropic.provider";
import { getCodexOAuthConfig } from "./providers/codex.provider";
import { getGitHubOAuthConfig } from "./providers/github.provider";
import { getGoogleOAuthConfig } from "./providers/google.provider";

export type { OAuthProviderConfig, OAuthTokenResponse, OAuthProviderStatus } from "./types";
export type { PKCEChallenge } from "./pkce";
export { generateAuthUrl, exchangeCode, refreshToken } from "./oauth-provider.service";
export { ANTHROPIC_STEALTH_HEADERS } from "./providers/anthropic.provider";
export { getCredentialStrategy, type CredentialStrategy } from "./credential-strategy";

type SupportedOAuthProvider = "anthropic" | "openai" | "github" | "google";

const PROVIDER_FACTORIES: Record<
  SupportedOAuthProvider,
  () => OAuthProviderConfig | null | Promise<OAuthProviderConfig | null>
> = {
  anthropic: getAnthropicOAuthConfig,
  openai: getCodexOAuthConfig,
  github: getGitHubOAuthConfig,
  google: getGoogleOAuthConfig,
};

export const getOAuthProvider = async (
  provider: string,
): Promise<OAuthProviderConfig | null> => {
  const factory = PROVIDER_FACTORIES[provider as SupportedOAuthProvider];
  if (!factory) return null;
  return factory();
};

export const getSupportedOAuthProviders = (): string[] => {
  return Object.keys(PROVIDER_FACTORIES);
};

export const ANTHROPIC_SETUP_TOKEN_PREFIX = "sk-ant-oat01-";
export const ANTHROPIC_SETUP_TOKEN_MIN_LENGTH = 80;

export const isAnthropicSetupToken = (apiKey: string): boolean => {
  return apiKey.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX);
};

// Backward-compat alias used in older call sites.
export const isOAuthToken = (apiKey: string): boolean => {
  return isAnthropicSetupToken(apiKey);
};

export const isAnthropicOAuthAuthMethod = (
  authMethod: string | null | undefined,
): boolean => {
  return (
    authMethod === "oauth" ||
    authMethod === "setup_token" ||
    authMethod === "subscription"
  );
};

export const getStealthHeaders = (
  provider: string,
  authMethod: string
): Record<string, string> | null => {
  if (provider === "anthropic" && isAnthropicOAuthAuthMethod(authMethod)) {
    return ANTHROPIC_STEALTH_HEADERS;
  }
  return null;
};
