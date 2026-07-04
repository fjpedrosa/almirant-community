import type { OnboardingStepKey } from "./types";

/**
 * Cloud deployments never expose the Tailscale step, so the Tailscale status
 * query must not poll there. Self-hosted keeps it enabled.
 */
export const tailscaleStatusEnabled = (isCloud: boolean): boolean => !isCloud;

/**
 * The GitHub connection status is only rendered inside the GitHub onboarding
 * step, so it should only be fetched while that step is the visible one.
 */
export const githubStepStatusEnabled = (
  currentStep: OnboardingStepKey | string,
): boolean => currentStep === "github";
