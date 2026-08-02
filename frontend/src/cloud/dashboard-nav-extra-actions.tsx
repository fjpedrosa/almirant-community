"use client";

/**
 * Extension point for downstream distributions to add extra actions to the
 * dashboard top navigation bar (`top-navigation-bar.tsx`) — e.g. an
 * additional nav tab, a status indicator — without patching that community
 * file directly. Rendered once, at the end of its right-hand action
 * cluster, right before the user avatar menu.
 *
 * Community keeps the default implementation inert: it renders nothing.
 *
 * Mirrors the seam already used for the signup funnel in
 * `signup-lifecycle-observer.ts` and for click analytics in
 * `posthog-click-tracking.tsx`. Unlike those two, this slot deliberately
 * does NOT cover the feedback entry point: `domains/feedback` is itself
 * generic and ported, so `top-navigation-bar.tsx` mounts
 * `FeedbackWidgetContainer` directly rather than through this seam.
 */
export function DashboardNavExtraActions() {
  return null;
}
