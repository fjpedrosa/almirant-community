"use client";

import { Button } from "@/components/ui/button";
import { PlatformProviderIcon } from "@/components/icons/platform-provider-icon";
import type { VercelConnectionButtonProps } from "../../domain/types";

export const VercelConnectionButton: React.FC<VercelConnectionButtonProps> = ({
  isConfigured,
  isConnected,
  onConnect,
  onDisconnect,
}) => {
  if (!isConfigured) {
    return (
      <Button variant="default" size="sm" onClick={onConnect}>
        <PlatformProviderIcon provider="vercel" className="h-4 w-4 mr-2" size={16} aria-hidden="true" />
        Connect Vercel
      </Button>
    );
  }

  if (isConnected) {
    return (
      <Button variant="outline" size="sm" onClick={onDisconnect}>
        <span
          className="h-2 w-2 rounded-full bg-green-500 mr-2"
          aria-hidden="true"
        />
        Disconnect
      </Button>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={onConnect}>
      <span
        className="h-2 w-2 rounded-full bg-yellow-500 mr-2"
        aria-hidden="true"
      />
      Reconnect
    </Button>
  );
};
