"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { ideasApi } from "@/lib/api/client";
import type { PromoteIdeaItemRequest, PromoteIdeaItemResponse } from "../../domain/types";
import { ideaKeys } from "./use-ideas";
import { workItemKeys } from "@/domains/work-items/application/hooks/use-work-items";

export const usePromoteIdea = (onSuccess?: (response: PromoteIdeaItemResponse) => void) => {
  const t = useTranslations("ideas.toasts");
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ideaItemId,
      data,
    }: {
      ideaItemId: string;
      data: PromoteIdeaItemRequest;
    }) => ideasApi.promote(ideaItemId, data) as Promise<PromoteIdeaItemResponse>,
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      showToast.success(t("ideaPromoted"));
      onSuccess?.(response);
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : t("promoteError"));
    },
  });
};
