import { Elysia } from "elysia";
import { getAuthProviders } from "@almirant/shared";
import { successResponse } from "../shared/services/response";

/**
 * Public endpoint that exposes the list of configured auth providers.
 *
 * Mounted outside the authenticated `/api` group on purpose: the login page
 * must fetch this list before any user is authenticated in order to render
 * the correct set of sign-in buttons / forms.
 */
export const authProvidersRoutes = new Elysia({ prefix: "/api/auth" }).get(
  "/providers",
  () =>
    successResponse({
      providers: getAuthProviders().list(),
    })
);
