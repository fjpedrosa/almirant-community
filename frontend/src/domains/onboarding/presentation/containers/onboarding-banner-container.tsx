"use client";

import { useRouter } from "next/navigation";
import { useOnboardingStatus } from "../../application/hooks/use-onboarding-status";
import { SetupCompletionBanner } from "../components/setup-completion-banner";
import { isCloudDeployment } from "@/lib/deployment-mode";

export const OnboardingBannerContainer = () => {
  const router = useRouter();
  const { data: status, isLoading } = useOnboardingStatus();

  // Don't show if: loading, no status, or onboarding already completed
  if (isLoading || !status || status.completedAt) {
    return null;
  }

  // Cloud only surfaces the GitHub App step; the admin account and public URL
  // are managed by the platform, so they never count as pending there.
  const pendingSteps = isCloudDeployment()
    ? status.github.done || status.github.skipped
      ? 0
      : 1
    : [
        status.admin.done,
        status.tailscale.done || status.tailscale.skipped,
        status.github.done || status.github.skipped,
      ].filter((v) => !v).length;

  if (pendingSteps === 0) {
    return null;
  }

  return (
    <div className="px-4 pt-2">
      <SetupCompletionBanner
        pendingSteps={pendingSteps}
        onGoToOnboarding={() => router.push("/onboarding")}
        onDismiss={() => {
          // For now dismiss is a no-op (banner only shows when steps are pending).
          // Future: persist dismiss preference.
        }}
      />
    </div>
  );
};

// Preserve the old named export for backward compat
export { OnboardingBannerContainer as default };
