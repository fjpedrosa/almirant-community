import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  createServiceAccountWithKey,
  getServiceAccountsByOrg,
  getServiceAccountById,
  deactivateServiceAccount,
  rotateServiceAccountKey,
  provisionDefaultServiceAccount,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../shared/services/response";

export const serviceAccountsRoutes = new Elysia({
  prefix: "/workspaces/:orgId/service-accounts",
})
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // POST /workspaces/:orgId/service-accounts
  // Create a new service account + initial API key
  // -------------------------------------------------------
  .post(
    "/",
    async ({ params, body, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;

        if (params.orgId !== orgId) {
          set.status = 403;
          return errorResponse("Workspace mismatch");
        }

        if (!body.name || body.name.trim() === "") {
          set.status = 400;
          return errorResponse("Name is required");
        }

        const result = await createServiceAccountWithKey(
          orgId,
          body.name.trim(),
          body.type
        );

        set.status = 201;
        return successResponse({
          serviceAccount: result.serviceAccount,
          key: result.key,
        });
      } catch (error) {
        // Unique constraint violation (duplicate name within org)
        const message =
          error instanceof Error ? error.message : "Failed to create service account";
        if (message.includes("unique") || message.includes("duplicate")) {
          set.status = 409;
          return errorResponse("A service account with that name already exists in this workspace");
        }
        set.status = 500;
        return errorResponse(message, 500);
      }
    },
    {
      params: t.Object({
        orgId: t.String(),
      }),
      body: t.Object({
        name: t.String(),
        type: t.Union([t.Literal("runner"), t.Literal("integration")]),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /workspaces/:orgId/service-accounts
  // List all active service accounts for the workspace
  // -------------------------------------------------------
  .get(
    "/",
    async ({ params, activeWorkspace, set }) => {
      try {
        const orgId = activeWorkspace!.id;

        if (params.orgId !== orgId) {
          set.status = 403;
          return errorResponse("Workspace mismatch");
        }

        const accounts = await getServiceAccountsByOrg(orgId);
        return successResponse(accounts);
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to fetch service accounts",
          500
        );
      }
    },
    {
      params: t.Object({
        orgId: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /workspaces/:orgId/service-accounts/provision
  // Idempotent: provision a default "runner" SA if none exists
  // -------------------------------------------------------
  .post(
    "/provision",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;

        if (params.orgId !== orgId) {
          set.status = 403;
          return errorResponse("Workspace mismatch");
        }

        const result = await provisionDefaultServiceAccount(orgId);

        if (!result) {
          return successResponse({
            provisioned: false,
            message: "Already provisioned",
          });
        }

        set.status = 201;
        return successResponse({
          provisioned: true,
          serviceAccount: result.serviceAccount,
        });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to provision service account",
          500
        );
      }
    },
    {
      params: t.Object({
        orgId: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // DELETE /workspaces/:orgId/service-accounts/:id
  // Deactivate a service account and revoke its API keys
  // -------------------------------------------------------
  .delete(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;

        if (params.orgId !== orgId) {
          set.status = 403;
          return errorResponse("Workspace mismatch");
        }

        const account = await getServiceAccountById(orgId, params.id);

        if (!account) {
          set.status = 404;
          return notFoundResponse("Service account");
        }

        if (account.name === "Default Runner" && account.type === "runner") {
          set.status = 409;
          return errorResponse(
            "Cannot delete the default service account. Use rotate-key instead."
          );
        }

        const deactivated = await deactivateServiceAccount(orgId, params.id);

        if (!deactivated) {
          set.status = 404;
          return notFoundResponse("Service account");
        }

        return successResponse({ deactivated: true });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to deactivate service account",
          500
        );
      }
    },
    {
      params: t.Object({
        orgId: t.String(),
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /workspaces/:orgId/service-accounts/:id/rotate-key
  // Rotate the API key for a service account
  // -------------------------------------------------------
  .post(
    "/:id/rotate-key",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;

        if (params.orgId !== orgId) {
          set.status = 403;
          return errorResponse("Workspace mismatch");
        }

        const result = await rotateServiceAccountKey(orgId, params.id);

        return successResponse({
          key: result.key,
          keyPrefix: result.keyPrefix,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to rotate key";

        if (message === "Service account not found") {
          set.status = 404;
          return notFoundResponse("Service account");
        }
        if (message === "Service account is deactivated") {
          set.status = 400;
          return errorResponse(message);
        }

        set.status = 500;
        return errorResponse(message, 500);
      }
    },
    {
      params: t.Object({
        orgId: t.String(),
        id: t.String(),
      }),
    }
  );
