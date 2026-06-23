import { Elysia } from "elysia";
import { env, logger } from "@almirant/config";
import { generateSessionToken } from "../../../shared/services/session-token";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  MCP_OAUTH_SCOPES,
  consumeMcpAuthorizationCode,
  createMcpAuthorizationCode,
  isAllowedChatGptRedirectUri,
  registerMcpOAuthClient,
  validateMcpOAuthClient,
} from "../services/mcp-oauth-store";

const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;

const getForwardedHeaderValue = (headers: Headers, name: string): string | null => {
  const value = headers.get(name);
  return value?.split(",")[0]?.trim() || null;
};

export const getPublicOriginFromRequest = (request: Request): string => {
  const url = new URL(request.url);
  const forwardedHost = getForwardedHeaderValue(request.headers, "x-forwarded-host");
  const forwardedProto = getForwardedHeaderValue(request.headers, "x-forwarded-proto");

  if (forwardedHost) {
    return `${forwardedProto ?? url.protocol.replace(":", "")}://${forwardedHost}`;
  }

  return url.origin;
};

const buildUrl = (request: Request, pathname: string): string =>
  new URL(pathname, getPublicOriginFromRequest(request)).toString();

/**
 * Keep OAuth control-plane routes outside `/mcp` and `/api/mcp`.
 *
 * `elysia-mcp` owns those prefixes as the MCP resource server. If OAuth routes
 * live below `/api/mcp/oauth/*`, Dynamic Client Registration requests can be
 * routed through the MCP authenticator first and fail with `401 Missing Bearer
 * token` before reaching the public registration handler.
 */
const MCP_OAUTH_BASE_PATH = "/api/oauth/mcp";

export const buildMcpOAuthAuthorizationServerMetadata = (request: Request) => {
  const issuer = getPublicOriginFromRequest(request);

  return {
    issuer,
    authorization_endpoint: buildUrl(request, `${MCP_OAUTH_BASE_PATH}/authorize`),
    token_endpoint: buildUrl(request, `${MCP_OAUTH_BASE_PATH}/token`),
    registration_endpoint: buildUrl(request, `${MCP_OAUTH_BASE_PATH}/register`),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    scopes_supported: MCP_OAUTH_SCOPES,
  };
};

export const buildMcpOAuthProtectedResourceMetadata = (request: Request) => ({
  resource: buildUrl(request, "/mcp"),
  authorization_servers: [getPublicOriginFromRequest(request)],
  bearer_methods_supported: ["header"],
  scopes_supported: MCP_OAUTH_SCOPES,
  resource_documentation: buildUrl(request, "/mcp/health"),
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const oauthJsonError = (
  error: string,
  errorDescription: string,
  status = 400,
): Response =>
  jsonResponse(
    {
      error,
      error_description: errorDescription,
    },
    status,
  );

const redirectWithOAuthError = (
  redirectUri: string,
  error: string,
  errorDescription: string,
  state?: string | null,
): Response => {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", errorDescription);
  if (state) url.searchParams.set("state", state);
  return Response.redirect(url.toString(), 302);
};

const redirectToFrontendSignIn = (request: Request): Response => {
  const frontendOrigin =
    env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).find((origin) =>
      origin.startsWith("https://"),
    ) ??
    env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).find((origin) =>
      origin.startsWith("http://"),
    ) ??
    getPublicOriginFromRequest(request);

  const signInUrl = new URL("/sign-in", frontendOrigin);
  const current = new URL(request.url);
  signInUrl.searchParams.set("redirectTo", `${current.pathname}${current.search}`);
  return Response.redirect(signInUrl.toString(), 302);
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderConsentPage = (request: Request, params: URLSearchParams): Response => {
  const action = new URL(request.url).pathname;
  const hiddenInputs = [...params.entries()]
    .filter(([key]) => key !== "confirm")
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect ChatGPT to Almirant</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; display: grid; min-height: 100vh; place-items: center; margin: 0; }
      main { width: min(92vw, 34rem); background: #111827; border: 1px solid #334155; border-radius: 1rem; padding: 2rem; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35); }
      h1 { margin: 0 0 1rem; font-size: 1.4rem; }
      p { color: #cbd5e1; line-height: 1.55; }
      button { width: 100%; border: 0; border-radius: 0.75rem; padding: 0.9rem 1rem; font-weight: 700; color: #020617; background: #a7f3d0; cursor: pointer; }
      small { display: block; color: #94a3b8; margin-top: 1rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Connect ChatGPT to Almirant</h1>
      <p>ChatGPT is asking for access to your Almirant workspace via MCP. It will be able to read and write project-management data using the MCP tools you expose.</p>
      <p><strong>Only continue if you started this connection from ChatGPT.</strong></p>
      <form method="get" action="${escapeHtml(action)}">
        ${hiddenInputs}
        <input type="hidden" name="confirm" value="1" />
        <button type="submit">Authorize ChatGPT</button>
      </form>
      <small>This issues a short-lived MCP token scoped to your active Almirant workspace.</small>
    </main>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

const parseTokenRequestBody = async (
  request: Request,
  parsedBody: unknown,
): Promise<URLSearchParams> => {
  if (parsedBody instanceof URLSearchParams) {
    return parsedBody;
  }

  if (typeof parsedBody === "string") {
    return new URLSearchParams(parsedBody);
  }

  if (parsedBody && typeof parsedBody === "object" && !(parsedBody instanceof FormData)) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(parsedBody as Record<string, unknown>)) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }

  if (parsedBody instanceof FormData) {
    const params = new URLSearchParams();
    for (const [key, value] of parsedBody.entries()) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await request.json()) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(json)) {
      if (typeof value === "string") params.set(key, value);
    }
    return params;
  }

  const body = await request.text();
  return new URLSearchParams(body);
};

const extractBasicClientCredentials = (
  request: Request,
): { clientId?: string; clientSecret?: string } => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) return {};

  try {
    const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64")
      .toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return {};

    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return {};
  }
};

export const mcpOAuthRoutes = new Elysia({ name: "mcp-oauth-routes" })
  .use(sessionContextTypes)
  .get(
    `${MCP_OAUTH_BASE_PATH}/authorize`,
    async ({ request, user, activeOrganization }) => {
      const url = new URL(request.url);
      const params = url.searchParams;
      const responseType = params.get("response_type");
      const clientId = params.get("client_id");
      const redirectUri = params.get("redirect_uri");
      const state = params.get("state");

      if (!redirectUri || !isAllowedChatGptRedirectUri(redirectUri, env.NODE_ENV)) {
        return oauthJsonError(
          "invalid_request",
          "redirect_uri must target ChatGPT, or localhost in development.",
        );
      }

      if (responseType !== "code") {
        return redirectWithOAuthError(
          redirectUri,
          "unsupported_response_type",
          "Only response_type=code is supported.",
          state,
        );
      }

      if (!clientId) {
        return redirectWithOAuthError(
          redirectUri,
          "invalid_request",
          "client_id is required.",
          state,
        );
      }

      if (!validateMcpOAuthClient({
        clientId,
        redirectUri,
        nodeEnv: env.NODE_ENV,
      })) {
        return redirectWithOAuthError(
          redirectUri,
          "invalid_client",
          "OAuth client is not allowed for this redirect_uri.",
          state,
        );
      }

      if (!user) {
        return redirectToFrontendSignIn(request);
      }

      if (!activeOrganization) {
        return redirectWithOAuthError(
          redirectUri,
          "access_denied",
          "Your Almirant session has no active workspace.",
          state,
        );
      }

      if (params.get("confirm") !== "1") {
        return renderConsentPage(request, params);
      }

      try {
        const code = createMcpAuthorizationCode({
          clientId,
          redirectUri,
          organizationId: activeOrganization.id,
          userId: user.id,
          scope: params.get("scope") ?? MCP_OAUTH_SCOPES.join(" "),
          codeChallenge: params.get("code_challenge") ?? undefined,
          codeChallengeMethod: params.get("code_challenge_method") ?? undefined,
        });

        const redirect = new URL(redirectUri);
        redirect.searchParams.set("code", code.code);
        if (state) redirect.searchParams.set("state", state);
        return Response.redirect(redirect.toString(), 302);
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "Failed to create MCP OAuth authorization code",
        );

        return redirectWithOAuthError(
          redirectUri,
          "invalid_request",
          error instanceof Error ? error.message : "Invalid OAuth request.",
          state,
        );
      }
    },
  )
  .post(`${MCP_OAUTH_BASE_PATH}/token`, async ({ request, body }) => {
    if (!env.ENCRYPTION_KEY) {
      return oauthJsonError(
        "server_error",
        "ENCRYPTION_KEY is required to issue MCP access tokens.",
        500,
      );
    }

    const params = await parseTokenRequestBody(request, body);
    const basicCredentials = extractBasicClientCredentials(request);
    const grantType = params.get("grant_type");
    const code = params.get("code");
    const redirectUri = params.get("redirect_uri");
    const clientId = basicCredentials.clientId ?? params.get("client_id") ?? undefined;
    const clientSecret =
      basicCredentials.clientSecret ?? params.get("client_secret") ?? undefined;

    if (grantType !== "authorization_code") {
      return oauthJsonError(
        "unsupported_grant_type",
        "Only grant_type=authorization_code is supported.",
      );
    }

    if (!code || !clientId || !redirectUri) {
      return oauthJsonError(
        "invalid_request",
        "code, client_id and redirect_uri are required.",
      );
    }

    const consumed = consumeMcpAuthorizationCode({
      code,
      clientId,
      redirectUri,
      clientSecret,
      codeVerifier: params.get("code_verifier") ?? undefined,
      nodeEnv: env.NODE_ENV,
    });

    if (!consumed) {
      return oauthJsonError(
        "invalid_grant",
        "Authorization code is invalid, expired, already used, or failed PKCE validation.",
        400,
      );
    }

    const token = generateSessionToken({
      organizationId: consumed.organizationId,
      ...(consumed.projectId ? { projectId: consumed.projectId } : {}),
      userId: consumed.userId,
      permissions: [...MCP_OAUTH_SCOPES],
      sessionType: "agent",
      ttlSeconds: ACCESS_TOKEN_TTL_SECONDS,
      signingSecret: env.ENCRYPTION_KEY,
    });

    return jsonResponse({
      access_token: token,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: consumed.scope,
    });
  })
  .post(`${MCP_OAUTH_BASE_PATH}/register`, async ({ request, body }) => {
    const parsedBody =
      body && typeof body === "object" && !(body instanceof FormData)
        ? body
        : await request.json().catch(() => null);

    const input = parsedBody as
      | {
          redirect_uris?: unknown;
          client_name?: unknown;
          token_endpoint_auth_method?: unknown;
        }
      | null;

    const redirectUris = Array.isArray(input?.redirect_uris)
      ? input.redirect_uris.filter((uri): uri is string => typeof uri === "string")
      : [];

    try {
      const client = registerMcpOAuthClient({
        redirectUris,
        clientName:
          typeof input?.client_name === "string" ? input.client_name : undefined,
        nodeEnv: env.NODE_ENV,
      });

      return jsonResponse(
        {
          client_id: client.clientId,
          client_secret: client.clientSecret,
          client_id_issued_at: Math.floor(client.issuedAt.getTime() / 1000),
          client_secret_expires_at: Math.floor(client.expiresAt.getTime() / 1000),
          redirect_uris: client.redirectUris,
          token_endpoint_auth_method: "client_secret_post",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          client_name: client.clientName ?? "ChatGPT",
        },
        201,
      );
    } catch (error) {
      return oauthJsonError(
        "invalid_client_metadata",
        error instanceof Error ? error.message : "Invalid client metadata.",
      );
    }
  });
