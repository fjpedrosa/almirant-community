import { signupLifecycleObserver } from "@/cloud/signup-lifecycle-observer";

export interface SignupLifecycleObserver {
  onPublicSignupPageOpened: () => void;
  onSignupSubmissionStarted: () => void;
  onSignupSucceeded: () => void;
  onSignupFailed: () => void;
  onFirstWorkspaceActivated: () => void;
}

const notify = (event: keyof SignupLifecycleObserver): void => {
  try {
    signupLifecycleObserver[event]();
  } catch {
    // Extensions are observational and must not affect authentication or navigation.
  }
};

export const notifyPublicSignupPageOpened = (): void => {
  notify("onPublicSignupPageOpened");
};

export const submitSignupWithLifecycle = async <T extends { error: unknown }>(
  submit: () => Promise<T>
): Promise<T> => {
  notify("onSignupSubmissionStarted");

  try {
    const result = await submit();
    notify(result.error ? "onSignupFailed" : "onSignupSucceeded");
    return result;
  } catch (error) {
    notify("onSignupFailed");
    throw error;
  }
};

export const completeFirstWorkspaceActivation = (complete: () => void): void => {
  notify("onFirstWorkspaceActivated");
  complete();
};
