import type { OAuthTokenResponse } from "./types";
import { exchangeIdTokenForApiKey } from "./openai-token-exchange";

const asNonEmptyString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
};

const normalizeDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
};

const getJwtExpirationDate = (token: string): Date | null => {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    return null;
  }

  return normalizeDate(new Date(payload.exp * 1000));
};

export const resolveEffectiveOAuthTokenExpiresAt = (params: {
  tokenExpiresAt?: string | Date | null;
  credentials?: Record<string, unknown> | null;
}): Date | null => {
  const persistedExpiry = normalizeDate(params.tokenExpiresAt);
  const oauthAccessToken = asNonEmptyString(params.credentials?.oauthAccessToken);
  const oauthTokenExpiry = oauthAccessToken
    ? getJwtExpirationDate(oauthAccessToken)
    : null;

  if (!oauthTokenExpiry) return persistedExpiry;
  if (!persistedExpiry) return oauthTokenExpiry;

  return oauthTokenExpiry.getTime() <= persistedExpiry.getTime()
    ? oauthTokenExpiry
    : persistedExpiry;
};

export const buildOAuthCredentialsFromTokenResponse = async (params: {
  provider: string;
  tokenResponse: OAuthTokenResponse;
  currentCredentials?: Record<string, unknown> | null;
  defaultScopes?: string | null;
}): Promise<Record<string, unknown>> => {
  const currentCredentials = params.currentCredentials ?? {};
  const accessToken = params.tokenResponse.access_token;
  const refreshToken =
    params.tokenResponse.refresh_token ??
    asNonEmptyString(currentCredentials.refreshToken);
  const oauthScopes =
    params.tokenResponse.scope ??
    params.defaultScopes ??
    asNonEmptyString(currentCredentials.oauthScopes);

  const nextCredentials: Record<string, unknown> = {
    ...currentCredentials,
    apiKey: accessToken,
    oauthAccessToken: accessToken,
    authMethod: "oauth",
  };

  if (refreshToken) {
    nextCredentials.refreshToken = refreshToken;
  }

  if (oauthScopes) {
    nextCredentials.oauthScopes = oauthScopes;
  }

  if (params.provider === "openai") {
    const exchangedApiKey = asNonEmptyString(
      params.tokenResponse.exchangedApiKey,
    );
    const idToken =
      asNonEmptyString(params.tokenResponse.id_token) ??
      asNonEmptyString(currentCredentials.idToken);

    if (exchangedApiKey) {
      nextCredentials.apiKey = exchangedApiKey;
    }

    if (idToken) {
      nextCredentials.idToken = idToken;

      if (!exchangedApiKey) {
        const exchangedFromIdToken = await exchangeIdTokenForApiKey(idToken);
        if (exchangedFromIdToken) {
          nextCredentials.apiKey = exchangedFromIdToken;
        }
      }
    }
  }

  return nextCredentials;
};
