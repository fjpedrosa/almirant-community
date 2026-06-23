import { Elysia, t } from "elysia";
import { completeLinkToken, getLinkToken } from "../../connections/services/link-token-store";
import { successResponse, errorResponse, notFoundResponse } from "../../../shared/services/response";

/**
 * Public (unauthenticated) endpoint for the CLI to submit credentials
 * back to the web app via a link token.
 *
 * This is mounted outside the session auth group because the CLI
 * does not have a session — it only knows the link token.
 */
export const linkTokenPublicRoutes = new Elysia({ prefix: "/link-token" })
  // -------------------------------------------------------
  // POST /link-token/:token/complete - CLI submits credentials
  // -------------------------------------------------------
  .post(
    "/:token/complete",
    async ({ params, body, set }) => {
      try {
        const entry = getLinkToken(params.token);

        if (!entry) {
          set.status = 404;
          return notFoundResponse("Link token (expired or invalid)");
        }

        if (entry.status !== "pending") {
          set.status = 409;
          return errorResponse("Link token has already been completed");
        }

        const completed = completeLinkToken(params.token, {
          credentials: body.credentials,
          config: body.config,
          connectionName: body.connectionName,
        });

        if (!completed) {
          set.status = 410;
          return errorResponse("Link token expired or already used");
        }

        return successResponse({
          status: "completed",
          provider: completed.provider,
        });
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : "Failed to complete link token",
          500,
        );
      }
    },
    {
      params: t.Object({
        token: t.String(),
      }),
      body: t.Object({
        credentials: t.Record(t.String(), t.Unknown()),
        config: t.Optional(t.Record(t.String(), t.Unknown())),
        connectionName: t.Optional(t.String()),
      }),
    },
  );
