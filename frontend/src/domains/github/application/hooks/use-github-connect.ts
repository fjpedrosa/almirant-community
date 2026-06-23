"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { githubKeys } from "./use-github-summary";

const buildGithubInstallUrl = (slug: string | null | undefined): string | undefined => {
  const normalizedSlug = slug?.trim();
  return normalizedSlug
    ? `https://github.com/apps/${normalizedSlug}/installations/select_target`
    : undefined;
};

export const useGithubConnect = (githubAppSlug?: string | null) => {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const waitingForInstall = useRef(false);

  const githubInstallUrl = useMemo(
    () => buildGithubInstallUrl(githubAppSlug),
    [githubAppSlug],
  );

  const syncInstallations = useCallback(async () => {
    setIsSyncing(true);
    try {
      await githubApi.syncInstallations();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: githubKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["connections"] }),
        queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
      ]);
    } catch {
      // Sync failed silently - status query will show current state
    } finally {
      setIsSyncing(false);
    }
  }, [queryClient]);

  // When user returns to tab after opening GitHub install page, trigger sync
  useEffect(() => {
    const handleFocus = () => {
      if (waitingForInstall.current) {
        waitingForInstall.current = false;
        syncInstallations();
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [syncInstallations]);

  const handleConnect = useCallback(() => {
    if (!githubInstallUrl) return;

    waitingForInstall.current = true;
    window.open(githubInstallUrl, "_blank");
  }, [githubInstallUrl]);

  const handleDisconnect = useCallback(() => {
    window.open("https://github.com/settings/installations", "_blank");
  }, []);

  return {
    handleConnect,
    handleDisconnect,
    syncInstallations,
    isSyncing,
    githubAppSlug: githubAppSlug?.trim() || null,
    githubInstallUrl,
  };
};
