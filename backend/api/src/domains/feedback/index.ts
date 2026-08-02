import { Elysia } from "elysia";
import { feedbackRoutes } from "./routes/feedback.routes";
import { feedbackScreenshotsRoutes } from "./routes/feedback-screenshots.routes";
import { publicFeedbackRoutes } from "./routes/public-feedback.routes";

export const feedbackModule = {
  /** Public feedback ingestion routes (no auth) - mounted outside /api */
  public: () => new Elysia().use(publicFeedbackRoutes),
  /** Protected feedback routes (session auth, workspace-scoped) - mounted under /api */
  protected: () =>
    new Elysia().use(feedbackRoutes).use(feedbackScreenshotsRoutes),
};
