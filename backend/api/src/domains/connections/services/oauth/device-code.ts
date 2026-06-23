/**
 * OpenAI Device Code Flow
 *
 * 1. Request a user_code from OpenAI's device auth endpoint
 * 2. User opens verification URL and enters the code
 * 3. Poll for authorization_code + PKCE codes
 * 4. Exchange via standard OAuth token endpoint
 * 5. Token exchange: convert id_token → openai-api-key (has api.responses.write)
 */

import { logger } from "@almirant/config";
import type { OAuthTokenResponse } from "./types";
import { exchangeIdTokenForApiKey } from "./openai-token-exchange";

const DEVICE_CODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const VERIFICATION_URL = "https://auth.openai.com/codex/device";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export interface DeviceCodeResponse {
  userCode: string;
  deviceAuthId: string;
  verificationUrl: string;
  interval: number;
}

export interface DeviceTokenPollResult {
  status: "pending" | "completed" | "expired" | "error";
  tokenResponse?: OAuthTokenResponse;
  error?: string;
}

/**
 * Step 1: Request a device code from OpenAI.
 * No scope parameter — OpenAI grants scopes based on the user's subscription.
 */
export const requestDeviceCode = async (): Promise<DeviceCodeResponse> => {
  const resp = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    logger.error({ status: resp.status, body }, "Failed to request OpenAI device code");
    throw new Error(`Failed to request device code: ${resp.status}`);
  }

  const data = (await resp.json()) as {
    device_auth_id: string;
    user_code: string;
    interval: number;
  };

  return {
    userCode: data.user_code,
    deviceAuthId: data.device_auth_id,
    verificationUrl: VERIFICATION_URL,
    interval: data.interval ?? 5,
  };
};

// exchangeIdTokenForApiKey is now in ./openai-token-exchange.ts

/**
 * Step 2: Poll for the authorization result.
 * Returns PKCE codes when the user has approved, then exchanges for tokens.
 * Finally, performs a token exchange to get an API key (which has api.responses.write).
 */
export const pollDeviceToken = async (
  deviceAuthId: string,
  userCode: string,
): Promise<DeviceTokenPollResult> => {
  // Poll the device auth endpoint
  const resp = await fetch(DEVICE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_auth_id: deviceAuthId,
      user_code: userCode,
    }),
  });

  if (resp.status === 403 || resp.status === 428) {
    // 403/428 = authorization_pending
    return { status: "pending" };
  }

  if (resp.status === 410) {
    return { status: "expired", error: "Device code expired" };
  }

  if (!resp.ok) {
    const body = await resp.text();
    logger.error({ status: resp.status, body }, "Device token poll failed");
    return { status: "error", error: `Poll failed: ${resp.status}` };
  }

  // Success — we get authorization_code + PKCE codes from OpenAI
  const data = (await resp.json()) as {
    authorization_code: string;
    code_challenge: string;
    code_verifier: string;
  };

  // Exchange the authorization_code for actual access/refresh tokens
  const tokenResp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: data.authorization_code,
      code_verifier: data.code_verifier,
      redirect_uri: "https://auth.openai.com/deviceauth/callback",
    }),
  });

  if (!tokenResp.ok) {
    const body = await tokenResp.text();
    logger.error({ status: tokenResp.status, body }, "Device token exchange failed");
    return { status: "error", error: `Token exchange failed: ${tokenResp.status}` };
  }

  const tokenResponse = (await tokenResp.json()) as OAuthTokenResponse & { id_token?: string };

  // Step 5: Token exchange — convert id_token into an API key with full permissions.
  // This is the same flow the Codex CLI uses. The resulting API key has api.responses.write.
  // IMPORTANT: We do NOT overwrite access_token — the raw OAuth token is needed
  // by the WHAM usage endpoint. The exchanged API key is stored separately.
  if (tokenResponse.id_token) {
    const apiKey = await exchangeIdTokenForApiKey(tokenResponse.id_token);
    if (apiKey) {
      (tokenResponse as unknown as Record<string, unknown>).exchangedApiKey = apiKey;
    }
  } else {
    logger.warn("No id_token in OAuth response — cannot exchange for API key");
  }

  return { status: "completed", tokenResponse };
};
