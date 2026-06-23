import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createLoggerMock, restoreRealModules } from "../../../../test/mocks";

mock.module("@almirant/config", () => createLoggerMock());

const originalFetch = globalThis.fetch;
const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];

describe("oauth-provider.service", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    globalThis.fetch = mock(
      async (url: string | URL | Request, init?: RequestInit) => {
        fetchCalls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({ access_token: "test-access-token", expires_in: 3600 }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exchanges Anthropic OAuth codes using JSON with state", async () => {
    const { exchangeCode } = await import("./oauth-provider.service");

    await exchangeCode(
      {
        name: "anthropic",
        authorizeUrl: "https://claude.ai/oauth/authorize",
        tokenUrl: "https://platform.claude.com/v1/oauth/token",
        redirectUri: "https://platform.claude.com/oauth/code/callback",
        clientId: "client-id",
        scopes: "user:profile",
        usePKCE: true,
        manualCodeEntry: true,
        extraAuthParams: { code: "true" },
        tokenRequestFormat: "json",
        includeStateInTokenExchange: true,
        authMode: "bearer",
      },
      "auth-code",
      "pkce-verifier",
      {
        state: "oauth-state",
      },
    );

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(fetchCalls[0]?.init?.body).toBe(
      JSON.stringify({
        grant_type: "authorization_code",
        client_id: "client-id",
        code: "auth-code",
        redirect_uri: "https://platform.claude.com/oauth/code/callback",
        code_verifier: "pkce-verifier",
        state: "oauth-state",
      }),
    );
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
