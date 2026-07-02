import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import { createLoggerMock, restoreRealModules, withTestOrg } from "../../../test/mocks";

const configMock = createLoggerMock();

mock.module("@almirant/config", () => ({
  ...configMock,
  env: {
    ...configMock.env,
    NODE_ENV: "test",
    CORS_ORIGIN: "http://localhost:3000",
    ENCRYPTION_KEY: "test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
}));

const form = (params: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(params).toString(),
});

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const sha256Base64Url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Buffer.from(digest)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

describe("mcpOAuthRoutes", () => {
  beforeEach(async () => {
    const { resetMcpOAuthStoreForTests } = await import("../services/mcp-oauth-store");
    resetMcpOAuthStoreForTests();
  });

  it("advertises OAuth control-plane endpoints outside the MCP resource prefix", async () => {
    const { buildMcpOAuthAuthorizationServerMetadata } = await import("./mcp-oauth.routes");

    const metadata = buildMcpOAuthAuthorizationServerMetadata(
      new Request("https://almirant.example/.well-known/oauth-authorization-server"),
    );

    expect(metadata.authorization_endpoint).toBe(
      "https://almirant.example/api/oauth/mcp/authorize",
    );
    expect(metadata.token_endpoint).toBe("https://almirant.example/api/oauth/mcp/token");
    expect(metadata.registration_endpoint).toBe(
      "https://almirant.example/api/oauth/mcp/register",
    );
  });

  it("allows Dynamic Client Registration before any user session exists", async () => {
    const [{ mcpOAuthRoutes }, { sessionAuthMiddleware }] = await Promise.all([
      import("./mcp-oauth.routes"),
      import("../../../shared/middleware/session-auth.middleware"),
    ]);
    const app = new Elysia().use(sessionAuthMiddleware).use(mcpOAuthRoutes);

    const response = await app.handle(
      new Request(
        "http://localhost/api/oauth/mcp/register",
        json({
          redirect_uris: ["http://localhost:8787/oauth/callback"],
          client_name: "ChatGPT Test",
        }),
      ),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { client_id: string };
    expect(body.client_id).toStartWith("alm_mcp_");
  });

  it("registers a ChatGPT OAuth client and exchanges an authorization code for an MCP token", async () => {
    const [{ mcpOAuthRoutes }, { verifySessionToken }] = await Promise.all([
      import("./mcp-oauth.routes"),
      import("../../../shared/services/session-token"),
    ]);
    const app = new Elysia().use(withTestOrg).use(mcpOAuthRoutes);
    const redirectUri = "http://localhost:8787/oauth/callback";

    const registerResponse = await app.handle(
      new Request(
        "http://localhost/api/oauth/mcp/register",
        json({
          redirect_uris: [redirectUri],
          client_name: "ChatGPT Test",
        }),
      ),
    );

    expect(registerResponse.status).toBe(201);
    const registration = (await registerResponse.json()) as {
      client_id: string;
      client_secret: string;
    };
    expect(registration.client_id).toStartWith("alm_mcp_");
    expect(registration.client_secret.length).toBeGreaterThan(20);

    const codeVerifier = "verifier-1234567890";
    const authorizeUrl = new URL("http://localhost/api/oauth/mcp/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", registration.client_id);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", "state-123");
    authorizeUrl.searchParams.set("code_challenge", await sha256Base64Url(codeVerifier));
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const consentResponse = await app.handle(new Request(authorizeUrl.toString()));
    expect(consentResponse.status).toBe(200);
    expect(consentResponse.headers.get("content-type")).toContain("text/html");

    authorizeUrl.searchParams.set("confirm", "1");
    const authorizeResponse = await app.handle(new Request(authorizeUrl.toString()));
    expect(authorizeResponse.status).toBe(302);

    const location = authorizeResponse.headers.get("location");
    expect(location).toBeTruthy();
    const callbackUrl = new URL(location!);
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri);
    expect(callbackUrl.searchParams.get("state")).toBe("state-123");
    const code = callbackUrl.searchParams.get("code");
    expect(code).toStartWith("alm_oac_");

    const tokenResponse = await app.handle(
      new Request(
        "http://localhost/api/oauth/mcp/token",
        form({
          grant_type: "authorization_code",
          code: code!,
          client_id: registration.client_id,
          client_secret: registration.client_secret,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      ),
    );

    expect(tokenResponse.status).toBe(200);
    const tokenBody = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
      scope: string;
    };
    expect(tokenBody.token_type).toBe("Bearer");
    expect(tokenBody.access_token).toStartWith("st_");
    expect(tokenBody.scope).toBe("mcp:read mcp:write");

    const payload = verifySessionToken(
      tokenBody.access_token,
      "test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    );
    expect(payload?.workspaceId).toBe("org-test-1");
    expect(payload?.userId).toBe("user-test-1");
    expect(payload?.projectId).toBeUndefined();
    expect(payload?.permissions).toEqual(["mcp:read", "mcp:write"]);
  });

  it("rejects non-ChatGPT redirect URIs in authorization requests", async () => {
    const { mcpOAuthRoutes } = await import("./mcp-oauth.routes");
    const app = new Elysia().use(withTestOrg).use(mcpOAuthRoutes);

    const url = new URL("http://localhost/api/oauth/mcp/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", "client-1");
    url.searchParams.set("redirect_uri", "https://evil.example/callback");

    const response = await app.handle(new Request(url.toString()));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });

  it("rejects reused authorization codes", async () => {
    const { mcpOAuthRoutes } = await import("./mcp-oauth.routes");
    const app = new Elysia().use(withTestOrg).use(mcpOAuthRoutes);
    const redirectUri = "http://localhost:8787/oauth/callback";

    const authorizeUrl = new URL("http://localhost/api/oauth/mcp/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", "static-client");
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("confirm", "1");

    const authorizeResponse = await app.handle(new Request(authorizeUrl.toString()));
    const callbackUrl = new URL(authorizeResponse.headers.get("location")!);
    const code = callbackUrl.searchParams.get("code")!;

    const first = await app.handle(
      new Request(
        "http://localhost/api/oauth/mcp/token",
        form({
          grant_type: "authorization_code",
          code,
          client_id: "static-client",
          redirect_uri: redirectUri,
        }),
      ),
    );
    expect(first.status).toBe(200);

    const second = await app.handle(
      new Request(
        "http://localhost/api/oauth/mcp/token",
        form({
          grant_type: "authorization_code",
          code,
          client_id: "static-client",
          redirect_uri: redirectUri,
        }),
      ),
    );
    expect(second.status).toBe(400);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("invalid_grant");
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
