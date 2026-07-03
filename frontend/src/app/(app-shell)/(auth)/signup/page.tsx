import { SignInContainer } from "@/domains/auth/presentation/containers/sign-in-container";
import { canAccessSignUpPage } from "@/domains/auth/application/lib/auth-route-state";
import { getAuthBootstrapStatus } from "@/lib/auth-bootstrap";
import { getEnabledAuthProviders } from "@/lib/auth-providers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const getSingleValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const hasInvitationIntent = (searchParams: SearchParams): boolean => {
  const invitation = getSingleValue(searchParams.invitation);
  const redirectTo = getSingleValue(searchParams.redirectTo);

  if (invitation === "1") {
    return true;
  }

  return Boolean(redirectTo?.startsWith("/accept-invitation/"));
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [bootstrapStatus, resolvedSearchParams] = await Promise.all([
    getAuthBootstrapStatus(),
    searchParams,
  ]);

  if (!canAccessSignUpPage(bootstrapStatus, hasInvitationIntent(resolvedSearchParams))) {
    redirect("/sign-in");
  }

  const socialProviders = await getEnabledAuthProviders();

  return (
    <SignInContainer
      mode={bootstrapStatus.needsInitialAdminSetup ? "initial_admin_setup" : "sign_up"}
      socialProviders={socialProviders}
    />
  );
}
