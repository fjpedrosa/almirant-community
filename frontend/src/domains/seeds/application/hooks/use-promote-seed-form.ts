"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { seedsApi } from "@/domains/planning/infrastructure/api/planning-api";
import { seedKeys } from "@/domains/planning/domain/query-keys";
import { workItemKeys } from "@/domains/work-items/application/hooks/use-work-items";
import type { PromoteSeedRequest } from "@/domains/planning/domain/types";

export const usePromoteSeed = (onSuccess?: () => void) => {
  const queryClient = useQueryClient();
  const t = useTranslations("seeds.toasts");

  return useMutation({
    mutationFn: ({
      seedId,
      data,
    }: {
      seedId: string;
      data: PromoteSeedRequest;
    }) => seedsApi.promote(seedId, data),
    onSuccess: () => {
      showToast.success(t("seedPromoted"));
      queryClient.invalidateQueries({ queryKey: seedKeys.all });
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      onSuccess?.();
    },
    onError: (error) =>
      showToast.error(
        error instanceof Error ? error.message : t("promoteError"),
      ),
  });
};
