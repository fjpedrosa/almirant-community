"use client";

import { useVercelStatus } from "../../application/hooks/use-vercel-status";
import { useVercelConnect } from "../../application/hooks/use-vercel-connect";
import { VercelConnectionStatus } from "../components/vercel-connection-status";
import { VercelConnectionButton } from "../components/vercel-connection-button";
import { SettingsPageShell } from "@/domains/settings/presentation/components/settings-page-shell";
import type { VercelSettingsContainerProps } from "../../domain/types";

export const VercelSettingsContainer: React.FC<
  VercelSettingsContainerProps
> = () => {
  const { data: status, isLoading } = useVercelStatus();
  const { handleConnect, handleDisconnect } = useVercelConnect();

  const defaultStatus = {
    configured: false,
    connected: false,
    connection: null,
  };

  const connectionStatus = status ?? defaultStatus;
  const isConnected = connectionStatus.connected;

  return (
    <SettingsPageShell
      title="Vercel"
      description="Connect your Vercel account to manage deployments and projects."
    >
      <div className="flex items-center gap-4">
        <VercelConnectionButton
          isConfigured={connectionStatus.configured}
          isConnected={isConnected}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
      </div>

      <VercelConnectionStatus
        status={connectionStatus}
        isLoading={isLoading}
      />
    </SettingsPageShell>
  );
};
