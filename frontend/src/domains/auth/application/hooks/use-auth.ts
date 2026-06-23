import { authClient } from "@/lib/auth-client";

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
      callbackURL,
      errorCallbackURL: "/sign-in?error=unauthorized",
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
    signInWithEmail,
    signUpWithEmail,
    signOut,
  };
};
