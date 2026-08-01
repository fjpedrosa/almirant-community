import type { SignupLifecycleObserver } from "@/domains/auth/application/lib/signup-lifecycle";

/**
 * Downstream distributions may replace this module with lifecycle behavior.
 * Community keeps the default implementation synchronous and inert.
 */
export const signupLifecycleObserver: SignupLifecycleObserver = {
  onPublicSignupPageOpened: () => {},
  onSignupSubmissionStarted: () => {},
  onSignupSucceeded: () => {},
  onSignupFailed: () => {},
  onFirstWorkspaceActivated: () => {},
};
