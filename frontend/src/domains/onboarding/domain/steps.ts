import type { OnboardingStepKey } from "./types";

/** Full onboarding flow for self-hosted (Community Edition) instances. */
export const SELF_HOSTED_ONBOARDING_STEPS: OnboardingStepKey[] = [
  "admin",
  "tailscale",
  "github",
];

/**
 * Cloud (cloud.almirant.ai) only needs the GitHub App step: the admin account
 * and the public URL are provisioned and managed by the platform.
 */
export const CLOUD_ONBOARDING_STEPS: OnboardingStepKey[] = ["github"];

/**
 * Steps the onboarding wizard should render/count for the current deployment.
 * Drives the sidebar nav, the default step, the "next step" hint and the
 * completion gate so hidden steps never block progress.
 */
export const getVisibleOnboardingSteps = (
  isCloud: boolean,
): OnboardingStepKey[] =>
  isCloud ? CLOUD_ONBOARDING_STEPS : SELF_HOSTED_ONBOARDING_STEPS;
