import { SignInContainer } from "@/domains/auth/presentation/containers/sign-in-container";
import { shouldRedirectSignInToSignUp } from "@/domains/auth/application/lib/auth-route-state";
import { getAuthBootstrapStatus } from "@/lib/auth-bootstrap";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const bootstrapStatus = await getAuthBootstrapStatus();

  if (shouldRedirectSignInToSignUp(bootstrapStatus)) {
    redirect("/signup");
  }

  return <SignInContainer mode="sign_in" />;
}
