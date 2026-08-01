import { isPostHogEnabled, posthog } from "@/lib/posthog";
import type { AuthPageMode } from "../../domain/types";
import type { SignupAttribution } from "./signup-attribution";

export type SignupEvent =
  | "cloud_signup_viewed"
  | "signup_started"
  | "signup_succeeded"
  | "signup_failed"
  | "activation_completed";

export const shouldTrackCloudSignupFunnel = (
  isCloudDeployment: boolean,
  mode: AuthPageMode,
  isPublicSignUp: boolean
): boolean => isCloudDeployment && mode === "sign_up" && isPublicSignUp;

export const shouldTrackActivationCompleted = (
  isCloudDeployment: boolean,
  attribution: SignupAttribution | null
): attribution is SignupAttribution => isCloudDeployment && attribution !== null;

export const trackSignupEvent = (
  event: SignupEvent,
  attribution: SignupAttribution
): void => {
  if (!isPostHogEnabled()) {
    return;
  }

  try {
    posthog.capture(event, attribution);
  } catch {
    // Analytics must never affect authentication.
  }
};
