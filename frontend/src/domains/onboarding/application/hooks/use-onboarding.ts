"use client";

/**
 * @deprecated Prefer `use-onboarding-status.ts` for new code.
 *
 * Backward-compat shims for pre-wizard callers (first-project flow,
 * dashboard banner). They map the zero-arg mutate() signature these
 * callers expect onto the step-aware primitives of the new wizard API.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { onboardingApi } from "@/lib/api/client";

// Legacy "skip the whole wizard" — callers use mutate() with no args.
// We map it to completing onboarding (no step context available at this call
// site). The new admin wizard has its own per-step skip via useSkipOnboardingStep.
export const useSkipOnboarding = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => onboardingApi.complete(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
};

// Legacy "dismiss the banner" — zero-arg completion.
export const useDismissOnboardingBanner = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => onboardingApi.complete(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
};
