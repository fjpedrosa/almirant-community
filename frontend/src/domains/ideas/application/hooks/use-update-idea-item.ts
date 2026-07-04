"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { ideasApi } from "@/lib/api/client";
import type { UpdateIdeaItemRequest } from "../../domain/types";
import { ideaMutationKeys } from "../../domain/query-keys";

export const useUpdateIdeaItem = () => {
  const t = useTranslations("ideas.toasts");
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateIdeaItemRequest }) =>
      ideasApi.update(id, data),
    onSuccess: (_result, variables) => {
      for (const queryKey of ideaMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
      showToast.success(t("itemUpdated"));
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : t("updateError"));
    },
  });
};
