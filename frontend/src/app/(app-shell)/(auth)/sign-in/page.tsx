import { SignInContainer } from "@/domains/auth/presentation/containers/sign-in-container";
import { shouldRedirectSignInToSignUp } from "@/domains/auth/application/lib/auth-route-state";
import { getAuthBootstrapStatus } from "@/lib/auth-bootstrap";
import { getEnabledAuthProviders } from "@/lib/auth-providers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const bootstrapStatus = await getAuthBootstrapStatus();

  if (shouldRedirectSignInToSignUp(bootstrapStatus)) {
    redirect("/signup");
  }

  const socialProviders = await getEnabledAuthProviders();

  return <SignInContainer mode="sign_in" socialProviders={socialProviders} />;
}
