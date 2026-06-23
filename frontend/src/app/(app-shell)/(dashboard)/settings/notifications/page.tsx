"use client";

import { useTranslations } from "next-intl";
import { EmailNotificationSettingsContainer } from "@/domains/settings/presentation/containers/email-notification-settings-container";
import { NotificationPreferencesContainer } from "@/domains/notifications/presentation/containers/notification-preferences-container";
import { SettingsPageShell } from "@/domains/settings/presentation/components/settings-page-shell";

export default function NotificationsSettingsPage() {
  const t = useTranslations("settings");

  return (
    <SettingsPageShell
      title={t("sections.notifications")}
      description={t("sections.notificationsDesc")}
    >
      <div className="grid gap-6">
        <NotificationPreferencesContainer />
        <EmailNotificationSettingsContainer />
      </div>
    </SettingsPageShell>
  );
}
