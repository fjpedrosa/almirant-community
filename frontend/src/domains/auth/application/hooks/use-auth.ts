import { authClient } from "@/lib/auth-client";

/**
 * Better-Auth resolves a RELATIVE `callbackURL` against its own `baseURL` — the
 * issuer, `api.almirant.ai`. On a split deploy (frontend on cloud.almirant.ai,
 * issuer on api.almirant.ai) that sends the post-OAuth redirect to
 * `api.almirant.ai/board` (a backend host that has no such route → NOT_FOUND).
 * Anchor the callback to the FRONTEND origin so the user lands back on the app.
 * cloud.almirant.ai must be in the issuer's trustedOrigins (it is).
 */
const toAbsoluteCallback = (callbackURL: string): string => {
  if (typeof window === "undefined") return callbackURL;
  try {
    return new URL(callbackURL, window.location.origin).toString();
  } catch {
    return callbackURL;
  }
};

const clearBetterAuthCookies = () => {
  if (typeof document === "undefined") return;

  const host = window.location.hostname;
  const domainParts = host.split(".");
  const parentDomain =
    domainParts.length >= 2
      ? `.${domainParts.slice(-2).join(".")}`
      : null;

  document.cookie.split(";").forEach((rawCookie) => {
    const name = rawCookie.split("=")[0].trim();
    if (name.includes("better-auth")) {
      const base = `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; path=/; SameSite=Lax`;
      document.cookie = base;
      document.cookie = `${base}; domain=${host}`;
      if (parentDomain) {
        document.cookie = `${base}; domain=${parentDomain}`;
      }
    }
  });
};

export const useAuth = () => {
  const session = authClient.useSession();

  const signInWithGoogle = (callbackURL = "/") => {
    authClient.signIn.social({
      provider: "google",
      callbackURL: toAbsoluteCallback(callbackURL),
      errorCallbackURL: toAbsoluteCallback("/sign-in?error=unauthorized"),
    });
  };

  const signInWithGithub = (callbackURL = "/") => {
    authClient.signIn.social({
      provider: "github",
      callbackURL: toAbsoluteCallback(callbackURL),
      errorCallbackURL: toAbsoluteCallback("/sign-in?error=unauthorized"),
    });
  };

  const signInWithEmail = async (
    email: string,
    password: string,
    callbackURL = "/"
  ) => {
    return authClient.signIn.email({
      email,
      password,
      callbackURL,
    });
  };

  const signUpWithEmail = async (
    name: string,
    email: string,
    password: string,
    callbackURL = "/"
  ) => {
    return authClient.signUp.email({
      name,
      email,
      password,
      callbackURL,
    });
  };

  const signOut = async () => {
    try {
      await authClient.signOut();
    } catch {
      // Ignore server-side signOut errors (e.g. expired/invalid session)
    }
    clearBetterAuthCookies();
    window.location.replace("/sign-in");
  };

  return {
    user: session.data?.user ?? null,
    isLoading: session.isPending,
    isAuthenticated: !!session.data?.user,
    signInWithGoogle,
    signInWithGithub,
    signInWithEmail,
    signUpWithEmail,
    signOut,
  };
};
