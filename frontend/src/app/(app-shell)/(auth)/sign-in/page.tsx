import { SignInContainer } from "@/domains/auth/presentation/containers/sign-in-container";
import { shouldRedirectSignInToSignUp } from "@/domains/auth/application/lib/auth-route-state";
import {
  getSignupAttribution,
  getSignupPath,
} from "@/domains/auth/application/lib/signup-attribution";
import { getAuthBootstrapStatus } from "@/lib/auth-bootstrap";
import { getEnabledAuthProviders } from "@/lib/auth-providers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [bootstrapStatus, resolvedSearchParams] = await Promise.all([
    getAuthBootstrapStatus(),
    searchParams,
  ]);

  if (shouldRedirectSignInToSignUp(bootstrapStatus)) {
    redirect("/signup");
  }

  const socialProviders = await getEnabledAuthProviders();

  return (
    <SignInContainer
      mode="sign_in"
      socialProviders={socialProviders}
      showSignUpLink={bootstrapStatus.allowRegistration}
      signUpHref={getSignupPath(getSignupAttribution(resolvedSearchParams))}
    />
  );
}
