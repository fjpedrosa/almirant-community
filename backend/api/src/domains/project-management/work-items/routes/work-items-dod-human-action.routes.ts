import { Elysia, t } from "elysia";
import {
  getWorkItemById,
  enqueueDodRemediationFromIntegrationFailure,
  clearDodHumanActionV2,
} from "@almirant/database";
import {
  dodHumanActionV2Schema,
  type DodHumanActionV2,
  type DodHumanActionOption,
} from "@almirant/shared";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";

/**
 * Routes for the structured DodHumanActionV2 panel. Surfaces the operator's
 * choice from the UI (apply Option X) into the corresponding backend action
 * — typically routing back into runner-fix-dod with a pre-built integration
 * context, or marking the item for a manual fix.
 *
 * Mounted under /api → /api/work-items/:id/dod-human-action/apply.
 */
export const workItemsDodHumanActionRoutes = new Elysia({ prefix: "/work-items" })
  .use(sessionContextTypes)
  .post(
    "/:id/dod-human-action/apply",
    async (ctx) => {
      const { params, body, set, activeWorkspace } = ctx;
      const user = (ctx as { user?: { id?: string } }).user ?? null;
      const orgId = activeWorkspace?.id;
      if (!orgId) {
        set.status = 401;
        return errorResponse("Missing active workspace");
      }

      const workItem = await getWorkItemById(params.id, orgId);
      if (!workItem) {
        set.status = 404;
        return notFoundResponse("Work item");
      }

      const metadata = (workItem.metadata ?? {}) as Record<string, unknown>;
      const rawV2 = metadata.dod_human_action_v2;
      if (!rawV2 || typeof rawV2 !== "object") {
        set.status = 400;
        return errorResponse(
          "Work item has no DodHumanActionV2 panel — nothing to apply",
        );
      }

      const parsed = dodHumanActionV2Schema.safeParse(rawV2);
      if (!parsed.success) {
        set.status = 500;
        return errorResponse(
          `Stored DodHumanActionV2 payload is malformed: ${parsed.error.message}`,
        );
      }
      const v2: DodHumanActionV2 = parsed.data;

      const option: DodHumanActionOption | undefined = v2.options.find(
        (opt) => opt.id === body.optionId,
      );
      if (!option) {
        set.status = 400;
        return errorResponse(
          `Option '${body.optionId}' not found in DodHumanActionV2 payload`,
        );
      }

      const action = option.action;
      switch (action.type) {
        case "trigger-runner-fix-dod": {
          await enqueueDodRemediationFromIntegrationFailure(workItem.id, {
            integrationContext: action.payload.integrationContext ?? {},
            failureReason: `Operator applied option '${option.id}' (${option.title}) from DodHumanActionV2 panel.`,
            triggeredBy: "release-integration",
          });
          await clearDodHumanActionV2(workItem.id, {
            optionId: option.id,
            appliedByUserId: user?.id ?? null,
            actionType: action.type,
          });
          return successResponse({
            applied: true,
            optionId: option.id,
            actionType: action.type,
            note: "Leaf descendants marked dod_incompleted=true; backlog-drain will dispatch runner-fix-dod on the next tick.",
          });
        }

        case "manual": {
          await clearDodHumanActionV2(workItem.id, {
            optionId: option.id,
            appliedByUserId: user?.id ?? null,
            actionType: action.type,
          });
          return successResponse({
            applied: true,
            optionId: option.id,
            actionType: action.type,
            note: "Marked as manually handled. Operator instructions: " +
              action.payload.instructions,
          });
        }

        case "trigger-runner-revert": {
          // v1: not implemented — reverting an integrated feature requires
          // git-revert + new release PR + re-validation, which is non-trivial
          // and intentionally out of scope until we have a dedicated skill.
          set.status = 501;
          return errorResponse(
            "Action 'trigger-runner-revert' is not yet supported. Apply manually via git revert + open a fresh release PR.",
          );
        }

        default: {
          // Exhaustiveness check — if the discriminated union grows we want
          // the type checker to flag this branch.
          const _never: never = action;
          void _never;
          set.status = 400;
          return errorResponse("Unsupported action type");
        }
      }
    },
    {
      body: t.Object({
        optionId: t.String({ minLength: 1 }),
      }),
    },
  );
