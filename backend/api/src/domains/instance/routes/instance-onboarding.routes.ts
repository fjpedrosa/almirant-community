import { Elysia, t } from "elysia";
import { db, user, count } from "@almirant/database";
import {
  getInstanceConfig,
  completeOnboarding,
  skipOnboardingStep,
} from "../services/instance-config-service";
import { getGithubAppStatus } from "../services/github-app-credentials-service";
import {
  successResponse,
  errorResponse,
} from "../../../shared/services/response";
import { requireAdmin } from "../../../middleware/require-admin.middleware";

export const instanceOnboardingRoutes = new Elysia({ prefix: "/onboarding" })
  .use(requireAdmin)

  // GET /onboarding/status
  .get("/status", async () => {
    const [config, [userCountRow], githubStatus] = await Promise.all([
      getInstanceConfig(),
      db.select({ value: count() }).from(user),
      getGithubAppStatus(),
    ]);

    const skipped = config.onboardingSkippedSteps ?? [];

    return successResponse({
      admin: {
        done: true,
        userCount: userCountRow?.value ?? 0,
      },
      tailscale: {
        done: config.publicUrl !== null,
        skipped: skipped.includes("tailscale"),
        publicUrl: config.publicUrl,
      },
      github: {
        // Configured by EITHER source: self-hosted persists into
        // instance_settings (githubAppId), cloud provides the App via env vars
        // (surfaced through getGithubAppStatus). appSlug prefers the persisted
        // value and falls back to the slug resolved from the env App.
        done: config.githubAppId !== null || githubStatus.configured,
        skipped: skipped.includes("github"),
        appSlug: config.githubAppSlug ?? githubStatus.slug,
      },
      completedAt: config.onboardingCompletedAt?.toISOString() ?? null,
    });
  })

  // POST /onboarding/complete
  .post("/complete", async ({ set }) => {
    try {
      const result = await completeOnboarding();
      return successResponse(result);
    } catch (err) {
      set.status = 500;
      return errorResponse(
        `Failed to complete onboarding: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }
  })

  // POST /onboarding/skip
  .post(
    "/skip",
    async ({ body, set }) => {
      try {
        const result = await skipOnboardingStep(body.step);
        return successResponse(result);
      } catch (err) {
        set.status = 500;
        return errorResponse(
          `Failed to skip onboarding step: ${err instanceof Error ? err.message : String(err)}`,
          500,
        );
      }
    },
    {
      body: t.Object({
        step: t.Union([
          t.Literal("admin"),
          t.Literal("tailscale"),
          t.Literal("github"),
        ]),
      }),
    },
  );
