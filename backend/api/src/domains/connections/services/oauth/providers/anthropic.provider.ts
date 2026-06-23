import { env } from "@almirant/config";
import type { OAuthProviderConfig } from "../types";

export const ANTHROPIC_STEALTH_HEADERS: Record<string, string> = {
  "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
  "user-agent": "claude-cli/2.1.2 (external, cli)",
  "x-app": "cli",
};

const ANTHROPIC_SUBSCRIPTION_SCOPES = [
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
].join(" ");

export const getAnthropicOAuthConfig = (): OAuthProviderConfig => ({
  name: "anthropic",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://platform.claude.com/v1/oauth/token",
  redirectUri:
    env.ANTHROPIC_OAUTH_REDIRECT_URI ??
    "https://platform.claude.com/oauth/code/callback",
  clientId:
    env.ANTHROPIC_OAUTH_CLIENT_ID ??
    "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  scopes: ANTHROPIC_SUBSCRIPTION_SCOPES,
  usePKCE: true,
  manualCodeEntry: true,
  extraAuthParams: {
    code: "true",
  },
  stealthHeaders: ANTHROPIC_STEALTH_HEADERS,
  tokenRequestFormat: "json",
  includeStateInTokenExchange: true,
  includeScopeInRefresh: true,
  authMode: "bearer",
});
