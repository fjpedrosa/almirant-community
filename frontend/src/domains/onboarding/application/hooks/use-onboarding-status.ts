"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { onboardingApi } from "@/lib/api/client";
import type { OnboardingState, OnboardingStepKey } from "../../domain/types";

export const onboardingKeys = {
  all: ["onboarding"] as const,
  status: () => [...onboardingKeys.all, "status"] as const,
};

export const useOnboardingStatus = () => {
  return useQuery<OnboardingState>({
    queryKey: onboardingKeys.status(),
    queryFn: () => onboardingApi.getStatus(),
  });
};

export const useCompleteOnboarding = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => onboardingApi.complete(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all });
    },
  });
};

export const useSkipOnboardingStep = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (step: OnboardingStepKey) => onboardingApi.skip(step),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all });
    },
  });
};
