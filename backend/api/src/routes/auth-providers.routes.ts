import { Elysia } from "elysia";
import { getAuthProviders } from "@almirant/shared";
import { successResponse } from "../shared/services/response";
import { getAuthBootstrapStatus } from "../domains/auth/better-auth/auth-bootstrap";
import { getPublicInstanceConfig } from "../domains/instance/services/instance-config-service";

/**
 * Public auth endpoints consumed by the login/signup pages BEFORE any session
 * exists. Mounted outside the authenticated `/api` group on purpose, and
 * BEFORE the Better-Auth `/api/auth/*` wildcard so these static routes resolve
 * first.
 *
 * - `GET /api/auth/providers` — configured sign-in providers (render buttons).
 * - `GET /api/auth/bootstrap-status` — whether the instance has users / needs
 *   an initial-admin setup / allows self-registration. Lets the frontend stay a
 *   thin client with NO database connection of its own.
 */
export const authProvidersRoutes = new Elysia({ prefix: "/api/auth" })
  .get("/providers", () =>
    successResponse({
      providers: getAuthProviders().list(),
    })
  )
  .get("/bootstrap-status", async () => {
    const [status, instanceConfig] = await Promise.all([
      getAuthBootstrapStatus(),
      getPublicInstanceConfig(),
    ]);
    return successResponse({
      ...status,
      onboardingCompleted: instanceConfig.onboardingCompleted,
    });
  });
