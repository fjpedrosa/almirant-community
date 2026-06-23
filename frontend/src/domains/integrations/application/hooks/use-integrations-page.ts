"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import { githubApi, connectionsApi } from "@/lib/api/client";
import { useCurrentUserTeams } from "@/domains/teams/application/hooks/use-current-user-teams";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { useConnections, connectionKeys } from "./use-connections";
import { useApiKeyConnectForm } from "./use-api-key-connect-form";
import { useOAuthConnect } from "./use-oauth-connect";
import { useSubscriptionConnect } from "./use-subscription-connect";
import { useIntegrationFeatureFlags } from "./use-integration-feature-flags";
import { githubKeys } from "@/domains/github/application/hooks/use-github-summary";
import { deriveIntegrationConnectionStatus } from "../../domain/connection-status";
import type {
  ApiKeyProvider,
  ConnectionScope,
  IntegrationProviderDefinition,
  IntegrationProviderItem,
  ProviderConnection,
  ProviderType,
  ProviderPanelState,
  UseIntegrationsPageReturn,
  WorkspaceOption,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Static catalog of all available providers
// ---------------------------------------------------------------------------

export const AVAILABLE_PROVIDERS: IntegrationProviderDefinition[] = [
  {
    provider: "github",
    name: "GitHub",
    description: "Connect repositories, sync issues and pull requests with work items.",
    category: "code",
    supportsOAuth: true,
  },
  {
    provider: "gitlab",
    name: "GitLab",
    description: "Connect repositories and sync merge requests with work items.",
    category: "code",
    supportsOAuth: true,
    comingSoon: true,
  },
  {
    provider: "openai",
    name: "OpenAI",
    description: "Use GPT models for AI-powered features like summaries and suggestions.",
    category: "ai",
    supportsOAuth: false,
  },
  {
    provider: "anthropic",
    name: "Anthropic",
    description: "Use Claude models for AI assistance, document analysis and code review.",
    category: "ai",
    supportsOAuth: false,
  },
  {
    provider: "google",
    name: "Google AI",
    description: "Use Gemini models for AI-powered content generation and analysis.",
    category: "ai",
    supportsOAuth: false,
  },
  {
    provider: "zai",
    name: "z.ai",
    description: "Connect z.ai GLM models for AI-powered workflows.",
    category: "ai",
    supportsOAuth: false,
  },
  {
    provider: "xai",
    name: "xAI",
    description: "Connect Grok models through the xAI API for OpenCode-powered workflows.",
    category: "ai",
    supportsOAuth: false,
  },
  {
    provider: "vercel",
    name: "Vercel",
    description: "Deploy previews and manage production deployments from your projects.",
    category: "deployment",
    supportsOAuth: true,
  },
  {
    provider: "sentry",
    name: "Sentry",
    description: "Monitor errors and performance issues across your applications.",
    category: "monitoring",
    supportsOAuth: false,
  },
  {
    provider: "posthog",
    name: "PostHog",
    description: "Track product analytics, feature flags, and user behavior.",
    category: "monitoring",
    supportsOAuth: false,
  },
  {
    provider: "discord",
    name: "Discord",
    description: "Send notifications and updates to Discord channels.",
    category: "communication",
    supportsOAuth: true,
  },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AI_PROVIDERS: ProviderType[] = [
  "openai",
  "anthropic",
  "google",
  "zai",
  "xai",
];

const WORKSPACE_API_KEY_PROVIDERS: ProviderType[] = ["sentry", "posthog"];

const WORKSPACE_CONNECTIONS_PARAMS = new URLSearchParams({
  scope: "organization",
});

const USER_CONNECTIONS_PARAMS = new URLSearchParams({
  scope: "user",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const groupConnectionsByProvider = (
  connections: ProviderConnection[],
): Map<ProviderType, ProviderConnection[]> => {
  const byProvider = new Map<ProviderType, ProviderConnection[]>();
  for (const connection of connections) {
    const existing = byProvider.get(connection.provider);
    if (existing) {
      existing.push(connection);
    } else {
      byProvider.set(connection.provider, [connection]);
    }
  }
  return byProvider;
};

/** Merge static provider catalog with workspace + user connection data. */
const mergeProviders = (
  definitions: IntegrationProviderDefinition[],
  workspaceConnections: ProviderConnection[],
  userConnections: ProviderConnection[],
  aiScope: ConnectionScope,
  isProviderVisible: (provider: ProviderType) => boolean,
  isProviderFlagged: (provider: ProviderType) => boolean,
): IntegrationProviderItem[] => {
  const workspaceByProvider = groupConnectionsByProvider(workspaceConnections);
  const userByProvider = groupConnectionsByProvider(userConnections);

  return definitions
    .filter((definition) => isProviderVisible(definition.provider))
    .map((definition) => {
      const connections =
        definition.category === "ai"
          ? aiScope === "organization"
            ? workspaceByProvider.get(definition.provider) ?? []
            : userByProvider.get(definition.provider) ?? []
          : workspaceByProvider.get(definition.provider) ?? [];

      // Find the best connection to derive status from (prefer active ones)
      const primaryConnection = connections.find(conn => conn.isActive) ?? connections[0];
      const isConnected = connections.length > 0;
      const connectionCount = connections.length;

      return {
        provider: definition.provider,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        status: deriveIntegrationConnectionStatus(primaryConnection),
        connections,
        isConnected,
        connectionCount,
        featureFlagged: isProviderFlagged(definition.provider),
        comingSoon: definition.comingSoon,
      };
    });
};

const mapWorkspaces = (
  workspaces: {
    id: string;
    name: string;
  }[],
): WorkspaceOption[] =>
  workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
  }));

// ---------------------------------------------------------------------------
// useIntegrationsPage - Page-level hook
// ---------------------------------------------------------------------------
// Workspace-scoped providers (GitHub, Vercel, Sentry, PostHog) always use the
// active workspace. AI providers can switch between workspace and personal.
// ---------------------------------------------------------------------------

export const useIntegrationsPage = (): UseIntegrationsPageReturn => {
  const t = useTranslations("integrations.toasts");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, ...confirmDialogProps } = useConfirmDialog();
  const [aiScope, setAiScope] = useState<ConnectionScope>("organization");
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [providerPanelState, setProviderPanelState] = useState<ProviderPanelState | null>(null);
  const { isProviderVisible, isProviderFlagged } = useIntegrationFeatureFlags();

  const { teams, isLoading: isLoadingTeams } = useCurrentUserTeams();
  const {
    activeTeamId,
    isLoading: isLoadingActiveTeam,
    setActiveTeam,
  } = useActiveTeam();

  const workspaces = useMemo(() => mapWorkspaces(teams), [teams]);

  const onWorkspaceChange = useCallback(
    async (workspaceId: string) => {
      if (!workspaceId || workspaceId === activeTeamId) {
        return;
      }

      setIsSwitchingWorkspace(true);
      try {
        await setActiveTeam(workspaceId);
      } catch {
        showToast.error(t("workspaceSwitchFailed"));
      } finally {
        setIsSwitchingWorkspace(false);
      }
    },
    [activeTeamId, setActiveTeam, t],
  );

  const {
    data: workspaceConnections,
    isLoading: isLoadingWorkspaceConnections,
  } = useConnections(WORKSPACE_CONNECTIONS_PARAMS);
  const { data: userConnections, isLoading: isLoadingUserConnections } =
    useConnections(USER_CONNECTIONS_PARAMS);

  // Dialog hooks
  const apiKeyForm = useApiKeyConnectForm(aiScope);
  const oauthConnect = useOAuthConnect();
  const subscriptionConnect = useSubscriptionConnect();

  // Merge static catalog with live connections, filtering by feature flags
  const providers = useMemo(
    () =>
      mergeProviders(
        AVAILABLE_PROVIDERS,
        workspaceConnections ?? [],
        userConnections ?? [],
        aiScope,
        isProviderVisible,
        isProviderFlagged,
      ),
    [workspaceConnections, userConnections, aiScope, isProviderVisible, isProviderFlagged],
  );

  const handleConnect = useCallback(
    (provider: ProviderType) => {
      if (AI_PROVIDERS.includes(provider)) {
        // AI providers respect the selected AI scope (workspace or personal).
        apiKeyForm.openForProvider(provider as ApiKeyProvider, aiScope);
      } else if (provider === "github") {
        // GitHub has an instance-level GitHub App setup step before workspace
        // installations can be selected. Keep the generic provider action on
        // that setup surface instead of relying on a build-time app slug.
        router.push("/settings/code-providers");
      } else if (provider === "vercel") {
        oauthConnect.openDialog("vercel");
      } else if (WORKSPACE_API_KEY_PROVIDERS.includes(provider)) {
        // Monitoring providers are workspace-scoped.
        apiKeyForm.openForProvider(provider as ApiKeyProvider, "organization");
      }
    },
    [apiKeyForm, aiScope, oauthConnect, router],
  );

  const handleManage = useCallback(
    (provider: ProviderType) => {
      if (AI_PROVIDERS.includes(provider)) {
        const source = aiScope === "organization" ? workspaceConnections : userConnections;
        const providerConnections = (source ?? []).filter(
          (connection) => connection.provider === provider
        );
        
        // Open Provider Panel for AI providers with multi-key support
        setProviderPanelState({
          provider,
          scope: aiScope,
          connections: providerConnections,
          isOpen: true,
        });
        return;
      }

      if (WORKSPACE_API_KEY_PROVIDERS.includes(provider)) {
        const providerConnections = (workspaceConnections ?? []).filter(
          (connection) => connection.provider === provider
        );
        
        if (providerConnections.length > 0) {
          // For multiple connections, prefer an active one or use the first available
          const primaryConnection = providerConnections.find(conn => conn.isActive) ?? providerConnections[0];
          apiKeyForm.openForProvider(provider as ApiKeyProvider, "organization", {
            id: primaryConnection.id,
            name: primaryConnection.name,
            config: primaryConnection.config,
          });
          return;
        }
      }

      handleConnect(provider);
    },
    [aiScope, apiKeyForm, handleConnect, userConnections, workspaceConnections],
  );

  // ---------------------------------------------------------------------------
  // GitHub-specific mutations
  // ---------------------------------------------------------------------------

  const resyncMutation = useMutation({
    mutationFn: () => githubApi.syncInstallations(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      queryClient.invalidateQueries({ queryKey: githubKeys.all });
      showToast.success(t("githubSynced"));
    },
    onError: () => {
      showToast.error(t("githubSyncFailed"));
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (connectionId: string) =>
      githubApi.disconnectInstallation(connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      queryClient.invalidateQueries({ queryKey: githubKeys.all });
      showToast.success(t("githubDisconnected"));
    },
    onError: () => {
      showToast.error(t("githubDisconnectFailed"));
    },
  });

  // Generic disconnect mutation for OAuth providers (Vercel, etc.)
  const genericDisconnectMutation = useMutation({
    mutationFn: (connectionId: string) => connectionsApi.delete(connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      showToast.success(t("disconnected"));
    },
    onError: () => {
      showToast.error(t("disconnectFailed"));
    },
  });

  const handleSubscriptionFromDialog = useCallback((provider?: ApiKeyProvider) => {
    const targetProvider = provider ?? apiKeyForm.selectedProvider;
    if (targetProvider !== "openai" && targetProvider !== "anthropic") {
      showToast.error(t("subscriptionOnlyOpenAI"));
      return;
    }
    apiKeyForm.setDialogOpen(false);
    subscriptionConnect.start(targetProvider);
  }, [apiKeyForm, subscriptionConnect, t]);

  const handleResync = useCallback(() => {
    resyncMutation.mutate();
  }, [resyncMutation]);

  const handleDisconnect = useCallback(
    async (connectionId: string) => {
      const confirmed = await confirm({
        title: "Disconnect GitHub",
        description:
          "Are you sure you want to disconnect this GitHub installation? This will remove access to linked repositories.",
        confirmLabel: "Disconnect",
        variant: "destructive",
      });
      if (!confirmed) return;
      disconnectMutation.mutate(connectionId);
    },
    [confirm, disconnectMutation],
  );

  const handleDisconnectProvider = useCallback(
    async (connectionId: string, providerName: string) => {
      const confirmed = await confirm({
        title: `Disconnect ${providerName}`,
        description: `Are you sure you want to disconnect ${providerName}? This will remove the integration and any associated configuration.`,
        confirmLabel: "Disconnect",
        variant: "destructive",
      });
      if (!confirmed) return;
      genericDisconnectMutation.mutate(connectionId);
    },
    [confirm, genericDisconnectMutation],
  );

  return {
    providers,
    isLoading:
      isLoadingWorkspaceConnections ||
      isLoadingUserConnections ||
      isSwitchingWorkspace,
    aiScope,
    setAiScope,
    workspaces,
    activeWorkspaceId: activeTeamId,
    isLoadingWorkspaces: isLoadingTeams || isLoadingActiveTeam,
    isSwitchingWorkspace,
    onWorkspaceChange,
    handleConnect,
    handleManage,
    handleResync,
    handleDisconnect,
    handleDisconnectProvider,
    isResyncing: resyncMutation.isPending,
    apiKeyForm,
    oauthConnect,
    confirmDialogProps,
    providerPanelState,
    setProviderPanelState,
    subscriptionConnect,
    handleSubscriptionFromDialog,
  };
};
