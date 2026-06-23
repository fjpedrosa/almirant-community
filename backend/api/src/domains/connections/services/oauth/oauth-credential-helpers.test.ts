import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const originalFetch = globalThis.fetch;

describe("oauth credential helpers", () => {
  beforeEach(() => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          access_token: "exchanged-openai-api-key",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  it("builds OpenAI OAuth credentials atomically with oauthAccessToken and exchanged apiKey", async () => {
    const { buildOAuthCredentialsFromTokenResponse } = await import(
      "./oauth-credential-helpers"
    );

    const credentials = await buildOAuthCredentialsFromTokenResponse({
      provider: "openai",
      tokenResponse: {
        access_token: "fresh-oauth-access-token",
        refresh_token: "fresh-refresh-token",
        expires_in: 3600,
        scope: "openid profile email offline_access",
        id_token: "fresh-id-token",
      },
      defaultScopes: "openid profile email offline_access",
      currentCredentials: {
        baseUrl: "https://api.openai.com/v1",
      },
    });

    expect(credentials).toEqual({
      apiKey: "exchanged-openai-api-key",
      oauthAccessToken: "fresh-oauth-access-token",
      authMethod: "oauth",
      refreshToken: "fresh-refresh-token",
      oauthScopes: "openid profile email offline_access",
      idToken: "fresh-id-token",
      baseUrl: "https://api.openai.com/v1",
    });
  });

  it("prefers the oauthAccessToken JWT expiry over a later stored tokenExpiresAt", async () => {
    const { resolveEffectiveOAuthTokenExpiresAt } = await import(
      "./oauth-credential-helpers"
    );

    const exp = Math.floor(Date.parse("2026-04-12T17:51:31.000Z") / 1000);
    const jwt = `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.sig`;

    const effectiveExpiry = resolveEffectiveOAuthTokenExpiresAt({
      tokenExpiresAt: "2026-04-22T17:47:39.412Z",
      credentials: {
        oauthAccessToken: jwt,
      },
    });

    expect(effectiveExpiry?.toISOString()).toBe("2026-04-12T17:51:31.000Z");
  });
});
