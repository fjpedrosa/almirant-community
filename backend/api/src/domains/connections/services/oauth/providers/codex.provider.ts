import { env } from "@almirant/config";
import type { OAuthProviderConfig } from "../types";

/**
 * Derive the frontend origin from CORS_ORIGIN (first http(s) entry) or
 * fall back to localhost for local development.
 */
const getFrontendOrigin = (): string => {
  const cors = env.CORS_ORIGIN ?? "";
  const origins = cors.split(",").map((s) => s.trim());
  // Prefer the first https origin, then any origin, then localhost fallback
  return (
    origins.find((o) => o.startsWith("https://")) ??
    origins.find((o) => o.startsWith("http")) ??
    "http://localhost:3000"
  );
};

const CODEX_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "api.connectors.read",
  "api.connectors.invoke",
  "api.responses.write",
].join(" ");

export const getCodexOAuthConfig = (): OAuthProviderConfig => ({
  name: "openai",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  redirectUri:
    env.OPENAI_CODEX_REDIRECT_URI ??
    `${getFrontendOrigin()}/auth/openai/callback`,
  clientId:
    env.OPENAI_CODEX_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann",
  scopes: CODEX_SCOPES,
  usePKCE: true,
  manualCodeEntry: false,
  extraAuthParams: {
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  },
  authMode: "bearer",
});
