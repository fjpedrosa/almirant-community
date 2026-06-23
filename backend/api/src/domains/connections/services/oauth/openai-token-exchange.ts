/**
 * Exchange an OpenAI id_token for an API key via the token-exchange grant.
 *
 * This is the same flow the Codex CLI uses — the resulting API key carries
 * the `api.responses.write` scope needed for inference.
 *
 * Extracted to a shared module so it can be called both during the initial
 * device-code flow and during subsequent token refreshes.
 *
 * @see https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs#L1058
 */

import { logger } from "@almirant/config";

const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export const exchangeIdTokenForApiKey = async (
  idToken: string,
): Promise<string | null> => {
  try {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: CLIENT_ID,
      requested_token: "openai-api-key",
      subject_token: idToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    });

    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.warn(
        { status: resp.status, body: text },
        "Token exchange for API key failed — falling back to access_token",
      );
      return null;
    }

    const data = (await resp.json()) as {
      access_token?: string;
      token?: string;
    };
    const apiKey = data.access_token ?? data.token;

    if (apiKey) {
      logger.info("Successfully exchanged id_token for OpenAI API key");
    }

    return apiKey ?? null;
  } catch (error) {
    logger.warn(
      error,
      "Token exchange for API key threw — falling back to access_token",
    );
    return null;
  }
};
