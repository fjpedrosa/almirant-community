import { Elysia } from "elysia";
import { requireAdmin } from "../../../middleware/require-admin.middleware";
import { adminVerifyRoute } from "./verify";
import { adminFeedbackRoutes } from "./feedback";
import { adminFeedbackTriageRoutes } from "./feedback-triage";
import { adminFeedbackTriageMetricsRoutes } from "./feedback-triage-metrics";
import { adminFeedbackMetricsRoutes } from "./feedback-metrics";
import { adminBugFixAttemptsRoutes } from "./bug-fix-attempts";

/**
 * Admin route group — mounted at /api/admin.
 * All routes under this group require the authenticated user to have
 * role === "admin" (enforced by the `requireAdmin` middleware).
 *
 * SCOPE (community port of the generic slice of Cloud's admin domain):
 * this group exposes the feedback + feedback-triage admin surface and the
 * bug-fix-attempts read/mark surface that the feedback-triage cluster-detail
 * modal depends on. Feedback is mono-project by definition (the instance's
 * own product), so none of these routes are workspace- or tenant-scoped.
 *
 * Cloud's `domains/admin` additionally mounts cross-workspace SaaS backoffice
 * surfaces (security audit log, waitlist, settings, users, invitations,
 * workspaces, cross-workspace PM/usage/agent-jobs). Those are genuinely
 * cloud-only multi-tenant concerns with no self-hosted equivalent and stay
 * out of community — see CLOUD_DELTA.md in the Cloud fork.
 */
export const adminRoutes = new Elysia({ prefix: "/admin" })
  .use(requireAdmin)
  .use(adminVerifyRoute)
  .use(adminFeedbackRoutes)
  .use(adminFeedbackTriageRoutes)
  .use(adminFeedbackTriageMetricsRoutes)
  .use(adminFeedbackMetricsRoutes)
  .use(adminBugFixAttemptsRoutes);
