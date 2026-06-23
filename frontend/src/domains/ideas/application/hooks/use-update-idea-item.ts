"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { ideasApi } from "@/lib/api/client";
import type { UpdateIdeaItemRequest } from "../../domain/types";
import { ideaKeys } from "./use-ideas";

export const useUpdateIdeaItem = () => {
  const t = useTranslations("ideas.toasts");
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateIdeaItemRequest }) =>
      ideasApi.update(id, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
      queryClient.invalidateQueries({ queryKey: ideaKeys.detail(variables.id) });
      showToast.success(t("itemUpdated"));
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : t("updateError"));
    },
  });
};
