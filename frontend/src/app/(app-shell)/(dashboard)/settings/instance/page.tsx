"use client";

import { useTranslations } from "next-intl";
import { InstanceSettingsContainer } from "@/domains/instance-settings/presentation/containers/instance-settings-container";
import { SettingsPageShell } from "@/domains/settings/presentation/components/settings-page-shell";

export default function InstanceSettingsPage() {
  const t = useTranslations("settings");

  return (
    <SettingsPageShell
      title={t("sections.instance")}
      description={t("sections.instanceDesc")}
    >
      <div className="max-w-6xl">
        <InstanceSettingsContainer />
      </div>
    </SettingsPageShell>
  );
}
