import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { getInstanceOnboardingState } from "@/lib/instance-status";
import { OnboardingWizardContainer } from "@/domains/onboarding/presentation/containers/onboarding-wizard-container";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();

  // Dashboard layout already guards unauthenticated users, but be defensive
  if (!session) {
    redirect("/sign-in");
  }

  // Only admins can access onboarding
  if (session.user.role !== "admin") {
    redirect("/board");
  }

  // If onboarding already completed, redirect unless ?force=1
  const params = await searchParams;
  const force = params.force === "1";
  const { completed } = await getInstanceOnboardingState();

  if (completed && !force) {
    redirect("/board");
  }

  return <OnboardingWizardContainer />;
}
