"use client";

import { SettingsLayoutContainer } from "@/domains/settings/presentation/containers/settings-layout-container";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SettingsLayoutContainer>{children}</SettingsLayoutContainer>;
}
