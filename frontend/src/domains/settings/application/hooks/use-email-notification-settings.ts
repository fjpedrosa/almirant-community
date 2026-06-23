"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { emailNotificationsApi } from "@/lib/api/client";
import type {
  EmailNotificationSettings,
  EmailNotificationToggleKey,
} from "../../domain/types";

const emailNotificationKeys = {
  all: ["email-notification-settings"] as const,
  settings: () => [...emailNotificationKeys.all] as const,
};

export const useEmailNotificationSettings = () => {
  const queryClient = useQueryClient();

  const { data: settings = null, isLoading } = useQuery({
    queryKey: emailNotificationKeys.settings(),
    queryFn: async () => {
      const result = await emailNotificationsApi.getSettings();
      return result as EmailNotificationSettings;
    },
  });

  const mutation = useMutation({
    mutationFn: (data: Record<string, boolean>) =>
      emailNotificationsApi.updateSettings(data),
    onMutate: async (newData) => {
      await queryClient.cancelQueries({
        queryKey: emailNotificationKeys.settings(),
      });

      const previousSettings = queryClient.getQueryData<EmailNotificationSettings>(
        emailNotificationKeys.settings()
      );

      if (previousSettings) {
        queryClient.setQueryData<EmailNotificationSettings>(
          emailNotificationKeys.settings(),
          { ...previousSettings, ...newData }
        );
      }

      return { previousSettings };
    },
    onError: (_err, _newData, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(
          emailNotificationKeys.settings(),
          context.previousSettings
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: emailNotificationKeys.settings(),
      });
    },
  });

  const handleToggle = useCallback(
    (key: EmailNotificationToggleKey, value: boolean) => {
      mutation.mutate({ [key]: value });
    },
    [mutation]
  );

  return {
    settings,
    isLoading,
    isSaving: mutation.isPending,
    handleToggle,
  };
};
