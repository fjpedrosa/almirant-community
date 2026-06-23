import { env, logger } from "@almirant/config";

// ---- Constants ----

const OPENAI_OAUTH_AUTHORIZE_URL = "https://platform.openai.com/oauth/authorize";
const OPENAI_TOKEN_ENDPOINT = "https://api.openai.com/v1/oauth/token";

// ---- Codex OAuth response types ----

export interface CodexTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope?: string;
}

// ---- Configuration check ----

export const isCodexConfigured = (): boolean => {
  return Boolean(env.OPENAI_CODEX_CLIENT_ID && env.OPENAI_CODEX_CLIENT_SECRET);
};

// ---- OAuth helpers ----

export const getCodexOAuthUrl = (state: string): string => {
  const params = new URLSearchParams({
    client_id: env.OPENAI_CODEX_CLIENT_ID ?? "",
    state,
    response_type: "code",
    scope: "openai.codex",
  });

  if (env.OPENAI_CODEX_REDIRECT_URI) {
    params.set("redirect_uri", env.OPENAI_CODEX_REDIRECT_URI);
  }

  return `${OPENAI_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
};

export const refreshCodexToken = async (
  refreshToken: string
): Promise<CodexTokenResponse> => {
  if (!env.OPENAI_CODEX_CLIENT_ID || !env.OPENAI_CODEX_CLIENT_SECRET) {
    throw new Error(
      "Codex OAuth credentials are not configured (OPENAI_CODEX_CLIENT_ID, OPENAI_CODEX_CLIENT_SECRET)"
    );
  }

  const body = new URLSearchParams({
    client_id: env.OPENAI_CODEX_CLIENT_ID,
    client_secret: env.OPENAI_CODEX_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(OPENAI_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, body: errorBody },
      "Failed to refresh Codex OAuth token"
    );
    throw new Error(
      `Codex token refresh failed with status ${response.status}: ${errorBody}`
    );
  }

  const data = (await response.json()) as CodexTokenResponse;

  logger.info(
    { scope: data.scope ?? "default" },
    "Successfully refreshed Codex OAuth token"
  );

  return data;
};

export const exchangeCodexCode = async (
  code: string
): Promise<CodexTokenResponse> => {
  if (!env.OPENAI_CODEX_CLIENT_ID || !env.OPENAI_CODEX_CLIENT_SECRET) {
    throw new Error(
      "Codex OAuth credentials are not configured (OPENAI_CODEX_CLIENT_ID, OPENAI_CODEX_CLIENT_SECRET)"
    );
  }

  const body = new URLSearchParams({
    client_id: env.OPENAI_CODEX_CLIENT_ID,
    client_secret: env.OPENAI_CODEX_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: env.OPENAI_CODEX_REDIRECT_URI ?? "",
  });

  const response = await fetch(OPENAI_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, body: errorBody },
      "Failed to exchange Codex OAuth code for access token"
    );
    throw new Error(
      `Codex token exchange failed with status ${response.status}: ${errorBody}`
    );
  }

  const data = (await response.json()) as CodexTokenResponse;

  logger.info(
    { scope: data.scope ?? "default" },
    "Successfully exchanged Codex OAuth code for access token"
  );

  return data;
};
