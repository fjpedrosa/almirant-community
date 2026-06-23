"use client";

import { useNotificationPreferencesPage } from "../../application/hooks/use-notification-preferences-page";
import { NotificationPreferencesForm } from "../components/notification-preferences-form";

export const NotificationPreferencesContainer: React.FC = () => {
  const { preferences, isLoading, onToggle } = useNotificationPreferencesPage();

  return (
    <NotificationPreferencesForm
      preferences={preferences}
      isLoading={isLoading}
      onToggle={onToggle}
    />
  );
};
