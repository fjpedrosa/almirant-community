import { Elysia } from "elysia";
import { getAuth } from "../better-auth/auth";

/**
 * Better-Auth issuer handler. Catches every `/api/auth/*` request (sign-in,
 * sign-up, email/password, Google OAuth callback, session, and the whole
 * organization plugin surface) and delegates to the Better-Auth `handler`,
 * which returns a standard `Response`.
 *
 * Mounted at ROOT level (outside the `/api` session-auth group) so it ISSUES
 * sessions instead of consuming them. `getAuth()` resolves the current instance
 * (re-created only when the runtime publicUrl changes).
 *
 * NOTE: the static `GET /api/auth/providers` route (`authProvidersRoutes`) must
 * be registered BEFORE this wildcard so Elysia resolves it first. Elysia's
 * router prioritizes static segments over wildcards, and registering it first
 * makes that ordering explicit.
 */
export const betterAuthRoutes = new Elysia({ name: "better-auth-routes" }).all(
  "/api/auth/*",
  async ({ request }) => {
    const auth = await getAuth();
    return auth.handler(request);
  },
  // CRITICAL: skip Elysia's body parsing. A Web Standard Request body can be
  // read only once; if Elysia parses it (by Content-Type) before we delegate,
  // Better-Auth's handler re-reads it and throws `TypeError: Body already used`
  // → 500 on every POST (sign-in/email, sign-in/social, sign-up, …). `parse:
  // "none"` hands Better-Auth the raw, unconsumed request.
  { parse: "none" },
);
