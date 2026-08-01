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
): boolean =>
  bootstrapStatus.needsInitialAdminSetup ||
  bootstrapStatus.allowRegistration ||
  hasInvitationIntent;

export const resolveSafeAuthRedirectTarget = (
  redirectTo: string | null,
  fallback = "/board"
): string => {
  if (
    !redirectTo ||
    !redirectTo.startsWith("/") ||
    redirectTo.startsWith("//") ||
    redirectTo.includes("\\")
  ) {
    return fallback;
  }

  try {
    const target = new URL(redirectTo, "https://app.invalid");
    const resolvedPath = `${target.pathname}${target.search}${target.hash}`;

    return target.origin === "https://app.invalid" &&
      resolvedPath.startsWith("/") &&
      !resolvedPath.startsWith("//")
      ? resolvedPath
      : fallback;
  } catch {
    return fallback;
  }
};
