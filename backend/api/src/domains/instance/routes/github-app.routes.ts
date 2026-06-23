import { Elysia, t } from "elysia";
import { requireAdmin } from "../../../middleware/require-admin.middleware";
import {
  getGithubAppStatus,
  saveGithubAppCredentials,
  validateGithubAppCredentials,
  clearGithubAppCredentials,
} from "../services/github-app-credentials-service";
import { getInstanceConfig } from "../services/instance-config-service";
import {
  createManifestState,
  getActiveManifestState,
  deleteManifestStateByState,
  cleanExpiredManifestStates,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
} from "../../../shared/services/response";
import { captureServerEvent } from "../../../shared/services/posthog-service";
import { logger } from "@almirant/config";

const MANIFEST_STATE_TTL_MS = 10 * 60 * 1000;

const RETURN_TO_ALLOWLIST = new Set<string>([
  "/onboarding",
  "/settings/github",
]);

const sanitizeReturnTo = (raw?: string | null): string => {
  if (!raw) return "/onboarding";
  return RETURN_TO_ALLOWLIST.has(raw) ? raw : "/onboarding";
};

export const githubAppRoutes = new Elysia({ prefix: "/instance/github-app" })
  .use(requireAdmin)

  // ──────────────────────────────────────────────
  // GET /instance/github-app/status
  // ──────────────────────────────────────────────
  .get("/status", async () => {
    const status = await getGithubAppStatus();
    return successResponse(status);
  })

  // ──────────────────────────────────────────────
  // POST /instance/github-app/credentials
  // ──────────────────────────────────────────────
  .post(
    "/credentials",
    async ({ body, set, admin }) => {
      const adminUser = admin as { id: string } | null;

      try {
        const creds = {
          appId: body.appId,
          slug: body.slug,
          clientId: body.clientId,
          clientSecret: body.clientSecret,
          webhookSecret: body.webhookSecret,
          privateKeyPem: body.privateKeyPem,
        };

        const validation = await validateGithubAppCredentials(creds);
        if (!validation.valid) {
          set.status = 422;
          return errorResponse(
            `GitHub App credentials are invalid: ${validation.error}`,
            422,
          );
        }

        await saveGithubAppCredentials(creds, adminUser?.id ?? "unknown");

        captureServerEvent(
          adminUser?.id ?? "unknown",
          "github_app.credentials.saved",
          { app_slug: creds.slug, source: "manual" },
        );

        const status = await getGithubAppStatus();
        return successResponse({
          ...status,
          appName: validation.appName ?? null,
        });
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err) },
          "Failed to save GitHub App credentials",
        );
        set.status = 500;
        return errorResponse(
          `Failed to save credentials: ${err instanceof Error ? err.message : String(err)}`,
          500,
        );
      }
    },
    {
      body: t.Object({
        appId: t.String(),
        slug: t.String(),
        clientId: t.String(),
        clientSecret: t.String(),
        webhookSecret: t.String(),
        privateKeyPem: t.String(),
      }),
    },
  )

  // ──────────────────────────────────────────────
  // DELETE /instance/github-app/credentials
  // ──────────────────────────────────────────────
  .delete("/credentials", async ({ set, admin }) => {
    const adminUser = admin as { id: string } | null;
    try {
      await clearGithubAppCredentials();
      captureServerEvent(
        adminUser?.id ?? "unknown",
        "github_app.credentials.cleared",
      );
      return successResponse({ cleared: true });
    } catch (err) {
      set.status = 500;
      return errorResponse(
        `Failed to clear credentials: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }
  })

  // ──────────────────────────────────────────────
  // GET /instance/github-app/manifest
  // ──────────────────────────────────────────────
  .get(
    "/manifest",
    async ({ query, set, admin }) => {
      const adminUser = admin as { id: string } | null;
      const state = query.state;
      const appNameRaw = (query.appName ?? "").trim();
      const returnTo = sanitizeReturnTo(query.returnTo);

      if (!state || state.length < 8) {
        set.status = 400;
        return errorResponse(
          "state query parameter is required (min 8 chars)",
        );
      }

      if (!appNameRaw) {
        set.status = 422;
        return errorResponse(
          "appName query parameter is required and cannot be empty",
          422,
        );
      }

      const instanceConfig = await getInstanceConfig();
      const publicUrl = instanceConfig.publicUrl;
      if (!publicUrl) {
        set.status = 400;
        return errorResponse(
          "Instance publicUrl is not configured. Set it in /settings before creating a GitHub App.",
        );
      }

      // Sweep expired rows lazily — single-pod self-host means this is fine.
      cleanExpiredManifestStates().catch((err) =>
        logger.warn({ err }, "manifest_states sweep failed"),
      );

      await createManifestState({
        state,
        appName: appNameRaw,
        returnTo,
        expiresAt: new Date(Date.now() + MANIFEST_STATE_TTL_MS),
        createdByUserId: adminUser?.id ?? null,
      });

      const manifest = {
        name: appNameRaw,
        url: publicUrl,
        hook_attributes: {
          url: `${publicUrl}/webhooks/github`,
        },
        setup_url: `${publicUrl}/settings/github/callback`,
        redirect_url: `${publicUrl}/api/instance/github-app/manifest-callback`,
        callback_urls: [
          `${publicUrl}/api/instance/github-app/manifest-callback`,
        ],
        public: false,
        default_permissions: {
          contents: "write",
          issues: "write",
          pull_requests: "write",
          metadata: "read",
          statuses: "write",
        },
        default_events: [
          "pull_request",
          "pull_request_review",
          "push",
          "issues",
          "issue_comment",
        ],
      };

      captureServerEvent(
        adminUser?.id ?? "unknown",
        "github_app.manifest.requested",
        { app_name: appNameRaw, return_to: returnTo },
      );

      return successResponse({ manifest, state });
    },
    {
      query: t.Object({
        state: t.String(),
        appName: t.Optional(t.String()),
        returnTo: t.Optional(t.String()),
      }),
    },
  )

  // ──────────────────────────────────────────────
  // GET /instance/github-app/manifest-callback
  // ──────────────────────────────────────────────
  .get(
    "/manifest-callback",
    async ({ query, set, admin }) => {
      const { code, state } = query;
      const adminUser = admin as { id: string } | null;
      const distinctId = adminUser?.id ?? "manifest-flow";

      // Sweep + lookup
      cleanExpiredManifestStates().catch((err) =>
        logger.warn({ err }, "manifest_states sweep failed"),
      );

      const stored = await getActiveManifestState(state);
      if (!stored) {
        captureServerEvent(distinctId, "github_app.manifest.callback.failed", {
          reason: "invalid_state",
        });
        set.status = 400;
        return errorResponse("Invalid or expired state parameter");
      }

      const returnTo = sanitizeReturnTo(stored.returnTo);

      try {
        const response = await fetch(
          `https://api.github.com/app-manifests/${code}/conversions`,
          {
            method: "POST",
            headers: {
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );

        if (!response.ok) {
          const respBody = await response.text();
          logger.error(
            { status: response.status, body: respBody },
            "GitHub manifest conversion failed",
          );
          captureServerEvent(
            distinctId,
            "github_app.manifest.callback.failed",
            {
              reason: "github_exchange_failed",
              error_code: response.status,
            },
          );
          set.status = 502;
          return errorResponse(
            `GitHub manifest conversion failed: ${response.status}`,
            502,
          );
        }

        const data = (await response.json()) as {
          id: number;
          slug: string;
          client_id: string;
          client_secret: string;
          webhook_secret: string;
          pem: string;
        };

        await saveGithubAppCredentials(
          {
            appId: String(data.id),
            slug: data.slug,
            clientId: data.client_id,
            clientSecret: data.client_secret,
            webhookSecret: data.webhook_secret,
            privateKeyPem: data.pem,
          },
          adminUser?.id ?? "manifest-flow",
        );

        await deleteManifestStateByState(state);

        captureServerEvent(
          distinctId,
          "github_app.manifest.callback.success",
          { app_slug: data.slug, app_id: data.id, return_to: returnTo },
        );

        const publicUrl = (await getInstanceConfig()).publicUrl ?? "";
        const redirectQuery =
          returnTo === "/onboarding" ? "?step=github&success=1" : "?success=1";
        const location = `${publicUrl}${returnTo}${redirectQuery}`;
        return new Response(null, {
          status: 302,
          headers: { Location: location },
        });
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err) },
          "GitHub manifest callback failed",
        );
        captureServerEvent(distinctId, "github_app.manifest.callback.failed", {
          reason: "exception",
          message: err instanceof Error ? err.message : String(err),
        });
        set.status = 500;
        return errorResponse(
          `Manifest callback failed: ${err instanceof Error ? err.message : String(err)}`,
          500,
        );
      }
    },
    {
      query: t.Object({
        code: t.String(),
        state: t.String(),
      }),
    },
  );
