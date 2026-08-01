"use client";

/**
 * Downstream distributions may replace this module with click-level product
 * analytics. Community keeps the default implementation inert: it renders
 * nothing, registers no listeners, and captures no events.
 *
 * Mirrors the seam already used for the signup funnel in
 * `signup-lifecycle-observer.ts`.
 */
export function PostHogClickTracking() {
  return null;
}
