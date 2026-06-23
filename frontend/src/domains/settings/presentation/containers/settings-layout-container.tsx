"use client";

import { useSettingsNavigation } from "../../application/hooks/use-settings-navigation";
import { SettingsLayout } from "../components/settings-layout";

export const SettingsLayoutContainer: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const { groups, activeSection, title, subtitle, betaLabel } = useSettingsNavigation();

  return (
    <SettingsLayout
      groups={groups}
      activeSection={activeSection}
      title={title}
      subtitle={subtitle}
      betaLabel={betaLabel}
    >
      {children}
    </SettingsLayout>
  );
};
