"use client";

import { useTranslations } from "next-intl";
import { Separator } from "@/components/ui/separator";
import { ChangePasswordSectionContainer } from "@/domains/settings/presentation/containers/change-password-section-container";
import { LocaleSelectorContainer } from "@/domains/settings/presentation/containers/locale-selector-container";
import { ThemeSelectorContainer } from "@/domains/settings/presentation/containers/theme-selector-container";
import { SettingsPageShell } from "@/domains/settings/presentation/components/settings-page-shell";

export default function GeneralSettingsPage() {
  const t = useTranslations("settings");

  return (
    <SettingsPageShell
      title={t("sections.general")}
      description={t("sections.generalDesc")}
    >
      <div className="space-y-10 max-w-2xl">
        <LocaleSelectorContainer />
        <Separator />
        <ThemeSelectorContainer />
        <Separator />
        <ChangePasswordSectionContainer />
      </div>
    </SettingsPageShell>
  );
}
