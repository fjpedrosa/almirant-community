"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useUpdateFeedbackStatus } from "./use-feedback-items";
import type { FeedbackStatus } from "../../domain/types";

interface UseFeedbackStatusChangeReturn {
  changeStatus: (id: string, status: FeedbackStatus) => void;
  isPending: boolean;
}

export const useFeedbackStatusChange = (): UseFeedbackStatusChangeReturn => {
  const t = useTranslations("feedback");
  const mutation = useUpdateFeedbackStatus();

  const changeStatus = useCallback(
    (id: string, status: FeedbackStatus) => {
      mutation.mutate(
        { id, status },
        {
          onSuccess: () => showToast.success(t(`moderation.${status}Success`)),
          onError: () => showToast.error(t("moderation.error")),
        }
      );
    },
    [mutation, t]
  );

  return { changeStatus, isPending: mutation.isPending };
};
