"use client";

import { useTranslations } from "next-intl";
import { useSettingsNavigation } from "../../application/hooks/use-settings-navigation";
import { SettingsNav } from "../components/settings-nav";
import { SettingsPageShell } from "../components/settings-page-shell";

export const SettingsPageContainer: React.FC = () => {
  const t = useTranslations("settings");
  const { sections, betaLabel } = useSettingsNavigation();

  return (
    <SettingsPageShell title={t("title")} description={t("subtitle")}>
      <SettingsNav sections={sections} betaLabel={betaLabel} />
    </SettingsPageShell>
  );
};
