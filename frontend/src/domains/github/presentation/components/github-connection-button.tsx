"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { PlatformProviderIcon } from "@/components/icons/platform-provider-icon";
import type { GithubConnectionButtonProps } from "../../domain/types";

export const GithubConnectionButton: React.FC<GithubConnectionButtonProps> = ({
  isConfigured,
  isConnected,
  githubAppSlug,
  onConnect,
  onDisconnect,
}) => {
  const t = useTranslations("github");

  if (!isConfigured) {
    if (!githubAppSlug) {
      return (
        <Button variant="default" size="sm" disabled>
          <AlertCircle className="h-4 w-4 mr-2" aria-hidden="true" />
          {t("connect")}
        </Button>
      );
    }

    return (
      <Button variant="default" size="sm" onClick={onConnect}>
        <PlatformProviderIcon provider="github" className="h-4 w-4 mr-2" size={16} aria-hidden="true" />
        {t("installApp")}
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
        {t("disconnect")}
      </Button>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={onConnect}>
      <span
        className="h-2 w-2 rounded-full bg-yellow-500 mr-2"
        aria-hidden="true"
      />
      {t("reconnect")}
    </Button>
  );
};
