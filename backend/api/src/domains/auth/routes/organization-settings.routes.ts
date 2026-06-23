import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import { getOrgSettings, upsertOrgSettings } from "@almirant/database";
import { successResponse, errorResponse } from "../../../shared/services/response";

// ---------------------------------------------------------------------------
// Elysia type schemas
// ---------------------------------------------------------------------------

const aiKeyPolicyValues = t.Union([
  t.Literal("org_only"),
  t.Literal("org_preferred"),
  t.Literal("user_preferred"),
  t.Literal("user_only"),
]);

const orchestrationStrategyValues = t.Union([
  t.Literal("round_robin"),
  t.Literal("sequential"),
  t.Literal("reset_first"),
  t.Null(),
]);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const organizationSettingsRoutes = new Elysia({
  prefix: "/organization-settings",
})
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // GET /organization-settings - Get settings for the active org
  // Returns default values if no settings row exists yet.
  // -------------------------------------------------------
  .get("/", async ({ activeOrganization, set }) => {
    try {
      const org = activeOrganization as { id: string } | null;
      if (!org?.id) {
        set.status = 403;
        return errorResponse("No active organization", 403);
      }
      const settings = await getOrgSettings(org.id);
      return successResponse(settings);
    } catch (error) {
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to get organization settings",
        500,
      );
    }
  })

  // -------------------------------------------------------
  // PATCH /organization-settings - Update (upsert) settings
  // -------------------------------------------------------
  .patch(
    "/",
    async ({ body, activeOrganization, set }) => {
      try {
        const org = activeOrganization as { id: string } | null;
        if (!org?.id) {
          set.status = 403;
          return errorResponse("No active organization", 403);
        }
        const settings = await upsertOrgSettings(org.id, {
          aiKeyPolicy: body.aiKeyPolicy,
          ...(body.orchestrationStrategy !== undefined && {
            orchestrationStrategy: body.orchestrationStrategy,
          }),
        });
        return successResponse(settings);
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to update organization settings",
          500,
        );
      }
    },
    {
      body: t.Object({
        aiKeyPolicy: aiKeyPolicyValues,
        orchestrationStrategy: t.Optional(orchestrationStrategyValues),
      }),
    },
  );
