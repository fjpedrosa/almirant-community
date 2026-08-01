import { signupLifecycleObserver } from "@/cloud/signup-lifecycle-observer";
import type { SignupAttribution } from "./signup-attribution";

/**
 * `SignupLifecycleObserver` predates attribution capture (the allowlisted
 * source/placement/plan metadata captured from the public signup funnel, see
 * `signup-attribution.ts`). Every event now optionally carries that payload
 * so the concrete Cloud observer (`@/cloud/signup-lifecycle-observer`) can
 * attach accurate, caller-supplied attribution instead of only re-deriving it
 * from session storage. The parameter is optional so any existing or future
 * observer implementation that ignores it keeps compiling untouched.
 */
export interface SignupLifecycleObserver {
  onPublicSignupPageOpened: (attribution?: SignupAttribution) => void;
  onSignupSubmissionStarted: (attribution?: SignupAttribution) => void;
  onSignupSucceeded: (attribution?: SignupAttribution) => void;
  onSignupFailed: (attribution?: SignupAttribution) => void;
  onFirstWorkspaceActivated: (attribution?: SignupAttribution) => void;
}

const notify = (
  event: keyof SignupLifecycleObserver,
  attribution?: SignupAttribution
): void => {
  try {
    if (attribution) {
      signupLifecycleObserver[event](attribution);
    } else {
      signupLifecycleObserver[event]();
    }
  } catch {
    // Extensions are observational and must not affect authentication or navigation.
  }
};

export const notifyPublicSignupPageOpened = (attribution?: SignupAttribution): void => {
  notify("onPublicSignupPageOpened", attribution);
};

export const submitSignupWithLifecycle = async <T extends { error: unknown }>(
  submit: () => Promise<T>,
  attribution?: SignupAttribution
): Promise<T> => {
  notify("onSignupSubmissionStarted", attribution);

  try {
    const result = await submit();
    notify(result.error ? "onSignupFailed" : "onSignupSucceeded", attribution);
    return result;
  } catch (error) {
    notify("onSignupFailed", attribution);
    throw error;
  }
};

export const completeFirstWorkspaceActivation = (
  complete: () => void,
  attribution?: SignupAttribution
): void => {
  notify("onFirstWorkspaceActivated", attribution);
  complete();
};
