"use client";

import { useInstanceSettings } from "../../application/hooks/use-instance-settings";
import { InstanceSettingsView } from "../components/instance-settings-view";

export const InstanceSettingsContainer = () => {
  const { publicUrl, tailscale, tailnetDatabase, capacity, operations, isLoading } =
    useInstanceSettings();

  return (
    <InstanceSettingsView
      publicUrl={publicUrl}
      tailscale={tailscale}
      tailnetDatabase={tailnetDatabase}
      capacity={capacity}
      operations={operations}
      isLoading={isLoading}
    />
  );
};
