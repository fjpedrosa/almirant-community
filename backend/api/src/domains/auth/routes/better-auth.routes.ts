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
);
