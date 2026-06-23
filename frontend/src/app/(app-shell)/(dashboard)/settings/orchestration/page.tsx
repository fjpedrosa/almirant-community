"use client";

import { useTranslations } from "next-intl";
import { OrchestrationSettingsContainer } from "@/domains/settings/presentation/containers/orchestration-settings-container";
import { SettingsPageShell } from "@/domains/settings/presentation/components/settings-page-shell";

export default function OrchestrationSettingsPage() {
  const t = useTranslations("settings");

  return (
    <SettingsPageShell
      title={t("sections.orchestration")}
      description={t("sections.orchestrationDesc")}
    >
      <OrchestrationSettingsContainer />
    </SettingsPageShell>
  );
}
