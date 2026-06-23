"use client";

import { useEmailNotificationSettings } from "../../application/hooks/use-email-notification-settings";
import { EmailNotificationSettings } from "../components/email-notification-settings";
import { Skeleton } from "@/components/ui/skeleton";

export const EmailNotificationSettingsContainer: React.FC = () => {
  const { settings, isLoading, isSaving, handleToggle } =
    useEmailNotificationSettings();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <EmailNotificationSettings
      settings={settings}
      isLoading={isLoading}
      isSaving={isSaving}
      onToggle={handleToggle}
    />
  );
};
