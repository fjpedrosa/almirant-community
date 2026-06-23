import { Elysia } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  getOrCreateOnboardingStatus,
  getOnboardingStatusWithAutoSync,
  dismissOnboardingBanner,
  resetBannerDismissal,
  skipOnboarding,
  logOnboardingEvent,
} from "@almirant/database";
import { logger } from "@almirant/config";
import { errorResponse, successResponse } from "../../../shared/services/response";

export const onboardingRoutes = new Elysia({ prefix: "/onboarding" })
  .use(sessionContextTypes)
  // -------------------------------------------------------
  // GET /onboarding/status - Get onboarding status (auto-sync with real state)
  // -------------------------------------------------------
  .get("/status", async ({ user }) => {
    try {
      const userId = (user as { id: string }).id;
      const status = await getOnboardingStatusWithAutoSync(userId);
      return successResponse(status);
    } catch (error) {
      logger.error(error, "Failed to get onboarding status");
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to get onboarding status",
        500
      );
    }
  })

  // -------------------------------------------------------
  // POST /onboarding/skip - Skip onboarding globally for current user
  // -------------------------------------------------------
  .post("/skip", async ({ user, set }) => {
    try {
      const userId = (user as { id: string }).id;
      await getOrCreateOnboardingStatus(userId);
      const updated = await skipOnboarding(userId);
      await logOnboardingEvent(userId, "all", "skip");
      return successResponse(updated);
    } catch (error) {
      logger.error(error, "Failed to skip onboarding");
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to skip onboarding",
        500
      );
    }
  })

  // -------------------------------------------------------
  // POST /onboarding/dismiss-banner - Dismiss banner for current user
  // -------------------------------------------------------
  .post("/dismiss-banner", async ({ user, set }) => {
    try {
      const userId = (user as { id: string }).id;
      await getOrCreateOnboardingStatus(userId);
      const updated = await dismissOnboardingBanner(userId);
      return successResponse(updated);
    } catch (error) {
      logger.error(error, "Failed to dismiss onboarding banner");
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to dismiss onboarding banner",
        500
      );
    }
  })

  // -------------------------------------------------------
  // POST /onboarding/reset-banner - Reset banner dismissal for current user
  // -------------------------------------------------------
  .post("/reset-banner", async ({ user, set }) => {
    try {
      const userId = (user as { id: string }).id;
      await getOrCreateOnboardingStatus(userId);
      const updated = await resetBannerDismissal(userId);
      return successResponse(updated);
    } catch (error) {
      logger.error(error, "Failed to reset onboarding banner");
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to reset onboarding banner",
        500
      );
    }
  });
