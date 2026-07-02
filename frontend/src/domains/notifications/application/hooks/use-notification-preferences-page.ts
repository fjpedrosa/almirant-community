"use client";

import { useCallback } from "react";
import { useNotificationPreferences, useUpdateNotificationPreference } from "./use-notifications";
import type { NotificationType, NotificationPreference, NotificationPreferencesFormProps } from "../../domain/types";

const NOTIFICATION_TYPES: NotificationType[] = ["assignment", "comment", "mention", "status_changed"];

const buildDefaultPreference = (type: NotificationType): NotificationPreference => ({
  id: "",
  userId: "",
  workspaceId: "",
  notificationType: type,
  inAppEnabled: true,
  emailEnabled: true,
  createdAt: "",
  updatedAt: "",
});

export const useNotificationPreferencesPage = (): NotificationPreferencesFormProps => {
  const { data: rawPreferences, isLoading } = useNotificationPreferences();
  const updatePreference = useUpdateNotificationPreference();

  const preferences: NotificationPreference[] = NOTIFICATION_TYPES.map((type) => {
    const existing = rawPreferences?.find((p) => p.notificationType === type);
    return existing ?? buildDefaultPreference(type);
  });

  const handleToggle = useCallback(
    (type: NotificationType, channel: "inApp" | "email" | "push", enabled: boolean) => {
      const current = preferences.find((p) => p.notificationType === type);
      const inAppEnabled = channel === "inApp" ? enabled : (current?.inAppEnabled ?? true);
      const emailEnabled = channel === "email" ? enabled : (current?.emailEnabled ?? true);

      updatePreference.mutate({
        notificationType: type,
        inAppEnabled,
        emailEnabled,
      });
    },
    [preferences, updatePreference]
  );

  return {
    preferences,
    isLoading,
    onToggle: handleToggle,
  };
};
