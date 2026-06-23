import type { AuthBootstrapStatus } from "../../domain/types";

export const shouldRedirectSignInToSignUp = (
  bootstrapStatus: AuthBootstrapStatus
): boolean => bootstrapStatus.needsInitialAdminSetup;

export const resolveAuthEntryPath = (
  bootstrapStatus: AuthBootstrapStatus
): "/sign-in" | "/signup" =>
  shouldRedirectSignInToSignUp(bootstrapStatus) ? "/signup" : "/sign-in";

export const canAccessSignUpPage = (
  bootstrapStatus: AuthBootstrapStatus,
  hasInvitationIntent: boolean
): boolean => bootstrapStatus.needsInitialAdminSetup || hasInvitationIntent;
