"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { githubApi, connectionsApi, githubAppApi } from "@/lib/api/client";
import { useConnections, connectionKeys } from "./use-connections";
import { githubKeys } from "@/domains/github/application/hooks/use-github-summary";
import { githubAppKeys } from "@/domains/onboarding/application/hooks/use-github-app-setup";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import type { GithubAppStatus } from "@/domains/onboarding/domain/types";
import type {
  GitHubAvailableInstallation,
  UseGitHubAccountPickerReturn,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildGithubInstallUrl = (slug: string | null | undefined): string | null => {
  const normalizedSlug = slug?.trim();
  return normalizedSlug
    ? `https://github.com/apps/${normalizedSlug}/installations/select_target`
    : null;
};

// ---------------------------------------------------------------------------
// useGitHubAccountPicker
// ---------------------------------------------------------------------------
// Manages the dialog state for connecting a GitHub account to the workspace.
// Fetches available GitHub App installations only after the instance-level
// GitHub App is configured. If the app is not configured, users are routed to
// /settings/code-providers, where they can create the self-hosted GitHub App first.
// ---------------------------------------------------------------------------

export const useGitHubAccountPicker = (): UseGitHubAccountPickerReturn => {
  const t = useTranslations("integrations.toasts");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [connectingId, setConnectingId] = useState<number | null>(null);

  const { data: githubAppStatus, isLoading: isLoadingGithubAppStatus } =
    useQuery<GithubAppStatus>({
      queryKey: githubAppKeys.status(),
      queryFn: () => githubAppApi.getStatus(),
    });

  const githubInstallUrl = useMemo(
    () => buildGithubInstallUrl(githubAppStatus?.slug),
    [githubAppStatus?.slug],
  );

  const isGithubAppConfigured = githubAppStatus?.configured ?? false;

  // Check for personal GitHub OAuth connection
  const userGithubParams = useMemo(
    () => new URLSearchParams({ scope: "user", provider: "github", isActive: "true" }),
    [],
  );
  const { data: userGithubConnections } = useConnections(userGithubParams);
  const personalOAuthConnection = useMemo(
    () => (userGithubConnections ?? []).find((c) => c.provider === "github"),
    [userGithubConnections],
  );
  const hasPersonalOAuth = !!personalOAuthConnection;

  const [isConnectingPersonal, setIsConnectingPersonal] = useState(false);

  const connectPersonalAccount = useCallback(async () => {
    setIsConnectingPersonal(true);
    try {
      const { url } = await connectionsApi.getOAuthUrl("github", "user");
      window.open(url, "_blank");
    } catch {
      showToast.error(t("githubOAuthFailed"));
    } finally {
      setIsConnectingPersonal(false);
    }
  }, [t]);

  // Fetch available installations only when the dialog is open and the
  // instance-level GitHub App exists. This prevents the normal UI from calling
  // /github/available-installations before credentials exist.
  const {
    data: installations = [],
    isLoading,
    error: fetchError,
    refetch,
  } = useQuery({
    queryKey: [...githubKeys.all, "available-installations"],
    queryFn: () =>
      githubApi.getAvailableInstallations() as Promise<
        GitHubAvailableInstallation[]
      >,
    enabled: dialogOpen && isGithubAppConfigured,
  });

  // Connect an installation to the current workspace
  const connectMutation = useMutation({
    mutationFn: (installationId: number) =>
      githubApi.connectInstallation(installationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      queryClient.invalidateQueries({ queryKey: githubKeys.all });
      showToast.success(t("githubConnected"));
      setDialogOpen(false);
      setConnectingId(null);
    },
    onError: () => {
      showToast.error(t("githubConnectFailed"));
      setConnectingId(null);
    },
  });

  const openDialog = useCallback(() => {
    if (githubAppStatus && !githubAppStatus.configured) {
      router.push("/settings/code-providers");
      return;
    }
    setDialogOpen(true);
  }, [githubAppStatus, router]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setConnectingId(null);
  }, []);

  useEffect(() => {
    if (!dialogOpen || !githubAppStatus || githubAppStatus.configured) return;

    setDialogOpen(false);
    router.push("/settings/code-providers");
  }, [dialogOpen, githubAppStatus, router]);

  const handleConnect = useCallback(
    (installationId: number) => {
      setConnectingId(installationId);
      connectMutation.mutate(installationId);
    },
    [connectMutation],
  );

  const handleInstallNew = useCallback(() => {
    if (githubInstallUrl) {
      window.open(githubInstallUrl, "_blank");
      return;
    }

    router.push("/settings/code-providers");
  }, [githubInstallUrl, router]);

  // Re-fetch installations when window regains focus (user returns from GitHub)
  useEffect(() => {
    if (!dialogOpen || !isGithubAppConfigured) return;

    const handleFocus = () => {
      refetch();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [dialogOpen, isGithubAppConfigured, refetch]);

  return {
    dialogOpen,
    openDialog,
    closeDialog,
    installations,
    isLoading: isLoading || isLoadingGithubAppStatus,
    connectingId,
    handleConnect,
    handleInstallNew,
    canInstallNew: !!githubInstallUrl,
    error: fetchError
      ? fetchError instanceof Error
        ? fetchError.message
        : "Failed to load installations"
      : null,
    hasPersonalOAuth,
    personalOAuthConnection,
    connectPersonalAccount,
    isConnectingPersonal,
  };
};
