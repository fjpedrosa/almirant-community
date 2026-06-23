import { Elysia } from "elysia";
import { env } from "@almirant/config";
import {
  SESSION_TOKEN_PREFIX,
  verifySessionToken,
  type SessionTokenPayload,
} from "../services/session-token";

/**
 * Context shape injected by the session-token-auth middleware.
 * Downstream handlers can check `sessionToken` to see if the request
 * was authenticated via a scoped session token (vs a regular session/API key).
 */
export type SessionTokenContext = Record<string, unknown> & {
  sessionToken: SessionTokenPayload | null;
};

/**
 * Middleware that validates scoped session tokens (JWTs) in the Authorization header.
 *
 * It checks for the `st_` prefix to distinguish session tokens from regular
 * API keys or better-auth session tokens. If the token is a valid session token,
 * it injects the decoded payload into the request context as `sessionToken`.
 *
 * This middleware is additive — it does NOT reject requests that lack a session token.
 * Use `requireSessionToken` (below) to enforce that a valid session token is present.
 *
 * Usage:
 *   .use(sessionTokenAuthMiddleware)  // derive sessionToken
 *   .use(requireSessionToken)          // optionally enforce it
 */
export const sessionTokenAuthMiddleware = new Elysia({
  name: "session-token-auth",
}).derive({ as: "scoped" }, async ({ request }) => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { sessionToken: null };
  }

  const raw = authHeader.slice(7);

  // Only handle tokens with the session-token prefix
  if (!raw.startsWith(SESSION_TOKEN_PREFIX)) {
    return { sessionToken: null };
  }

  const signingSecret = env.ENCRYPTION_KEY;
  if (!signingSecret) {
    return { sessionToken: null };
  }

  const payload = verifySessionToken(raw, signingSecret);
  return { sessionToken: payload };
});

/**
 * Guard that requires a valid session token. Returns 401 if missing/invalid.
 * Must be used after `sessionTokenAuthMiddleware`.
 */
export const requireSessionToken = new Elysia({
  name: "require-session-token",
}).onBeforeHandle({ as: "scoped" }, (ctx) => {
  const sessionToken = (ctx as unknown as Record<string, unknown>)
    .sessionToken as SessionTokenPayload | null;

  if (!sessionToken) {
    ctx.set.status = 401;
    return { success: false, error: "Unauthorized: valid session token required" };
  }
});

/**
 * Guard that checks if the session token has a specific permission.
 * Returns a factory so it can be parameterized:
 *
 *   .use(requirePermission("mcp:write"))
 */
export const requirePermission = (permission: string) =>
  new Elysia({ name: `require-permission-${permission}` }).onBeforeHandle(
    { as: "scoped" },
    (ctx) => {
      const sessionToken = (ctx as unknown as Record<string, unknown>)
        .sessionToken as SessionTokenPayload | null;

      if (!sessionToken) {
        ctx.set.status = 401;
        return { success: false, error: "Unauthorized: valid session token required" };
      }

      if (!sessionToken.permissions.includes(permission)) {
        ctx.set.status = 403;
        return {
          success: false,
          error: `Forbidden: missing permission '${permission}'`,
        };
      }
    }
  );
