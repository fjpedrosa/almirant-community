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
import { getVisibleOnboardingSteps } from "../../domain/steps";
import { isCloudDeployment } from "@/lib/deployment-mode";

export const useOnboardingWizard = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Which deployment is this build? Cloud shows only the GitHub App step.
  const isCloud = isCloudDeployment();
  const visibleSteps = useMemo(
    () => getVisibleOnboardingSteps(isCloud),
    [isCloud],
  );

  // Derive current step from URL or default. Ignore any ?step that is not part
  // of the visible flow (e.g. ?step=admin in cloud) and fall back to the first
  // visible step.
  const stepParam = searchParams.get("step") as OnboardingStepKey | null;
  const initialStep =
    stepParam && visibleSteps.includes(stepParam)
      ? stepParam
      : visibleSteps[0];
  const [currentStep, setCurrentStep] =
    useState<OnboardingStepKey>(initialStep);

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

  // Completion gate is scoped to the visible steps:
  // - cloud: the GitHub App step is the only one, so onboarding is completable
  //   as soon as it is done.
  // - self-hosted: unchanged 2-of-3 rule (admin is always done, so this means
  //   "at least one of tailscale/github").
  const canComplete = isCloud ? githubDone : doneCount >= 2;

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
    // Self-hosted: record the skip and stay in the wizard (other steps remain).
    if (!isCloud) {
      skipMutation.mutate("github");
      return;
    }

    // Cloud: GitHub is the only step. Skipping it finishes onboarding and sends
    // the user straight to the app, so they are never stuck on the wizard.
    skipMutation.mutate("github", {
      onSuccess: () => {
        completeMutation.mutate(undefined, {
          onSuccess: () => router.push("/board"),
        });
      },
    });
  }, [isCloud, skipMutation, completeMutation, router]);

  return {
    // Deployment / steps
    isCloud,
    visibleSteps,
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
    isSkippingGithub: skipMutation.isPending || completeMutation.isPending,
    handleSkipGithub,
  };
};
