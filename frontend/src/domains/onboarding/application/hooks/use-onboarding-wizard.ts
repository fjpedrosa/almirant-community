"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useOnboardingStatus,
  useCompleteOnboarding,
  useSkipOnboardingStep,
} from "./use-onboarding-status";
import { useTailscaleSetup } from "./use-tailscale-setup";
import { useGithubAppSetup } from "./use-github-app-setup";
import type { OnboardingStepKey } from "../../domain/types";

export const useOnboardingWizard = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Derive current step from URL or default
  const stepParam = searchParams.get("step") as OnboardingStepKey | null;
  const [currentStep, setCurrentStep] = useState<OnboardingStepKey>(
    stepParam ?? "admin"
  );

  // Data hooks
  const {
    data: onboardingState,
    isLoading: isLoadingStatus,
    error: statusError,
  } = useOnboardingStatus();

  const completeMutation = useCompleteOnboarding();
  const skipMutation = useSkipOnboardingStep();
  const tailscale = useTailscaleSetup();

  // Derived state
  const adminDone = onboardingState?.admin.done ?? false;
  const tailscaleDone = onboardingState?.tailscale.done ?? false;
  const githubDone = onboardingState?.github.done ?? false;
  const publicUrl = onboardingState?.tailscale.publicUrl ?? null;

  const githubApp = useGithubAppSetup({ returnTo: "/onboarding", publicUrl });

  const doneCount = useMemo(() => {
    return [adminDone, tailscaleDone, githubDone].filter(Boolean).length;
  }, [adminDone, tailscaleDone, githubDone]);

  const canComplete = doneCount >= 2;

  const handleStepChange = useCallback((step: OnboardingStepKey) => {
    setCurrentStep(step);
  }, []);

  const handleComplete = useCallback(() => {
    completeMutation.mutate(undefined, {
      onSuccess: () => {
        router.push("/board");
      },
    });
  }, [completeMutation, router]);

  const handleSkipTailscale = useCallback(() => {
    skipMutation.mutate("tailscale");
  }, [skipMutation]);

  const handleSkipGithub = useCallback(() => {
    skipMutation.mutate("github");
  }, [skipMutation]);

  return {
    // Loading / Error
    isLoading: isLoadingStatus,
    error: statusError,
    // Step navigation
    currentStep,
    handleStepChange,
    // Step status
    adminDone,
    tailscaleDone,
    githubDone,
    publicUrl,
    canComplete,
    isCompleting: completeMutation.isPending,
    handleComplete,
    // Admin
    adminEmail: "", // filled by the container from auth context
    adminUserCount: onboardingState?.admin.userCount ?? 0,
    // Tailscale
    tailscale,
    isSkippingTailscale: skipMutation.isPending,
    handleSkipTailscale,
    // GitHub
    githubApp,
    isSkippingGithub: skipMutation.isPending,
    handleSkipGithub,
  };
};
