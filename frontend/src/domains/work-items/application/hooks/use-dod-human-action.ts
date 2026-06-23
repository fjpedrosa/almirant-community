"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useTranslations } from "next-intl";
import { workItemsApi } from "@/lib/api/client";
import { workItemKeys } from "./use-work-items";

export interface ApplyDodHumanActionInput {
  workItemId: string;
  optionId: string;
}

export interface ApplyDodHumanActionResult {
  applied: boolean;
  optionId: string;
  actionType: string;
  note?: string;
}

/**
 * Apply an option from the DodHumanActionV2 panel. The backend dispatches the
 * action embedded in the option (re-implement vs revert vs manual) and clears
 * the v2 payload + gate flags from the work item metadata.
 *
 * On success: invalidates work-item queries so the panel disappears and the
 * detail view re-renders with the new state.
 */
export const useApplyDodHumanAction = () => {
  const queryClient = useQueryClient();
  const t = useTranslations("workItems");

  return useMutation({
    mutationFn: ({ workItemId, optionId }: ApplyDodHumanActionInput) =>
      workItemsApi.applyDodHumanAction(workItemId, optionId),
    onSuccess: (data: ApplyDodHumanActionResult) => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      const successKey = `dodHumanAction.${data.actionType}.success` as const;
      const fallbackKey = "dodHumanAction.applied" as const;
      // Translation files may add per-actionType variants over time; for now
      // the single fallback covers all three branches.
      showToast.success(
        t.has(successKey) ? t(successKey) : t(fallbackKey),
        data.note ? { description: data.note } : undefined,
      );
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      showToast.error(t("dodHumanAction.error"), { description: message });
    },
  });
};
