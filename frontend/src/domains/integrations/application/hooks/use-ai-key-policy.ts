"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import {
  useWorkspaceSettings,
  useUpdateWorkspaceSettings,
} from "./use-workspace-settings";
import type { AiKeyPolicy } from "../../domain/types";

// ---------------------------------------------------------------------------
// Hook: useAiKeyPolicy
// ---------------------------------------------------------------------------
// Reads the current AI key policy from workspace settings and provides
// a handler to update it. Auto-saves on change with toast feedback.
// ---------------------------------------------------------------------------

export const useAiKeyPolicy = () => {
  const t = useTranslations("integrations.toasts");
  const { data: settings, isLoading } = useWorkspaceSettings();
  const mutation = useUpdateWorkspaceSettings();

  const updatePolicy = useCallback(
    (policy: AiKeyPolicy) => {
      if (policy === settings?.aiKeyPolicy) return;

      mutation.mutate(
        { aiKeyPolicy: policy },
        {
          onSuccess: () => {
            showToast.success(t("policyUpdated"));
          },
          onError: () => {
            showToast.error(t("policyFailed"));
          },
        }
      );
    },
    [settings?.aiKeyPolicy, mutation, t]
  );

  return {
    currentPolicy: settings?.aiKeyPolicy ?? "org_preferred",
    isLoading,
    isUpdating: mutation.isPending,
    updatePolicy,
  };
};
