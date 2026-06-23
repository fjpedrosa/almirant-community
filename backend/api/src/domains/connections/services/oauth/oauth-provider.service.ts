import { logger } from "@almirant/config";
import type { OAuthProviderConfig, OAuthTokenResponse } from "./types";
import { generatePKCE, type PKCEChallenge } from "./pkce";

export interface AuthUrlResult {
  url: string;
  state: string;
  pkce: PKCEChallenge | null;
}

export const generateAuthUrl = async (
  config: OAuthProviderConfig,
  state: string
): Promise<AuthUrlResult> => {
  let pkce: PKCEChallenge | null = null;

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    state,
  });

  if (config.usePKCE) {
    pkce = await generatePKCE();
    params.set("code_challenge", pkce.codeChallenge);
    params.set("code_challenge_method", "S256");
  }

  if (config.extraAuthParams) {
    for (const [key, value] of Object.entries(config.extraAuthParams)) {
      params.set(key, value);
    }
  }

  const url = `${config.authorizeUrl}?${params.toString()}`;
  return { url, state, pkce };
};

export const exchangeCode = async (
  config: OAuthProviderConfig,
  code: string,
  codeVerifier?: string | null,
  options?: {
    state?: string | null;
    expiresIn?: number;
  },
): Promise<OAuthTokenResponse> => {
  const bodyData: Record<string, string | number> = {
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
  };

  if (config.clientSecret) {
    bodyData.client_secret = config.clientSecret;
  }

  if (config.usePKCE && codeVerifier) {
    bodyData.code_verifier = codeVerifier;
  }

  if (config.includeStateInTokenExchange && options?.state) {
    bodyData.state = options.state;
  }

  if (typeof options?.expiresIn === "number") {
    bodyData.expires_in = options.expiresIn;
  }

  const tokenRequestFormat = config.tokenRequestFormat ?? "form";
  const headers: Record<string, string> = {
    "Content-Type":
      tokenRequestFormat === "json"
        ? "application/json"
        : "application/x-www-form-urlencoded",
    ...config.stealthHeaders,
    ...config.tokenRequestHeaders,
  };
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body:
      tokenRequestFormat === "json"
        ? JSON.stringify(bodyData)
        : new URLSearchParams(
            Object.fromEntries(
              Object.entries(bodyData).map(([key, value]) => [key, String(value)]),
            ),
          ).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, body: errorBody, provider: config.name },
      "OAuth token exchange failed"
    );
    throw new Error(
      `OAuth token exchange failed for ${config.name} with status ${response.status}: ${errorBody}`
    );
  }

  return (await response.json()) as OAuthTokenResponse;
};

export const refreshToken = async (
  config: OAuthProviderConfig,
  currentRefreshToken: string
): Promise<OAuthTokenResponse> => {
  const bodyData: Record<string, string> = {
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: currentRefreshToken,
  };

  if (config.clientSecret) {
    bodyData.client_secret = config.clientSecret;
  }

  if (config.includeScopeInRefresh) {
    bodyData.scope = config.scopes;
  }

  const tokenRequestFormat = config.tokenRequestFormat ?? "form";
  const headers: Record<string, string> = {
    "Content-Type":
      tokenRequestFormat === "json"
        ? "application/json"
        : "application/x-www-form-urlencoded",
    ...config.stealthHeaders,
    ...config.tokenRequestHeaders,
  };
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body:
      tokenRequestFormat === "json"
        ? JSON.stringify(bodyData)
        : new URLSearchParams(bodyData).toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, body: errorBody, provider: config.name },
      "OAuth token refresh failed"
    );
    throw new Error(
      `OAuth token refresh failed for ${config.name} with status ${response.status}: ${errorBody}`
    );
  }

  return (await response.json()) as OAuthTokenResponse;
};
