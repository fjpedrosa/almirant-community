import { Elysia, t } from "elysia";
import { env } from "@almirant/config";
import { sendEmail } from "../../../shared/services/email-service";
import { buildEmailMemberRemoved } from "../../../shared/services/email/templates";

/**
 * Internal (server-to-server) email endpoints, guarded by a shared secret
 * header (`x-internal-email-secret`). Mounted PUBLIC — outside the `/api`
 * session-auth group — because the frontend calls it from a server action
 * (no user session), not from the browser.
 *
 * Only `member-removed` lives here: invitation emails are now sent in-process
 * by the Better-Auth organization plugin, so `/internal/emails/invitations` is
 * no longer needed.
 */
export const internalEmailsRoutes = new Elysia({
  prefix: "/internal/emails",
}).post(
  "/member-removed",
  async ({ request, body, set }) => {
    const secret = env.INTERNAL_EMAIL_API_SECRET?.trim();
    const provided = request.headers
      .get("x-internal-email-secret")
      ?.trim();

    if (!secret || !provided || provided !== secret) {
      set.status = 401;
      return { success: false as const, error: "Unauthorized" };
    }

    const { subject, html } = buildEmailMemberRemoved({
      memberName: body.memberName,
      workspaceName: body.organizationName,
      removedAt: body.removedAt,
    });

    const result = await sendEmail({
      to: body.email,
      subject,
      html,
    });

    if (!result.success) {
      set.status = 500;
      return {
        success: false as const,
        error: result.error ?? "Failed to send member removal email",
      };
    }

    return { success: true as const };
  },
  {
    body: t.Object({
      email: t.String(),
      memberName: t.String(),
      organizationName: t.String(),
      removedAt: t.String(),
    }),
  },
);
