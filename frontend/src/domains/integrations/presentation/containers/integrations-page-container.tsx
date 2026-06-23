"use client";

import { Suspense, useCallback } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { useIntegrationsPage } from "../../application/hooks/use-integrations-page";
import { useAddProviderPanel } from "../../application/hooks/use-add-provider-panel";
import { useConnections } from "../../application/hooks/use-connections";
import { AiScopeSelector } from "../components/scope-selector";
import { WorkspaceSelector } from "../components/workspace-selector";
import { IntegrationsGrid } from "../components/integrations-grid";
import { AiKeyPolicyContainer } from "./ai-key-policy-container";
import {
  GitHubAccountPickerDialogContainer,
  useGitHubAccountPicker,
} from "./github-account-picker-dialog-container";
import { ApiKeyConnectDialogContainer } from "./api-key-connect-dialog-container";
import { OAuthConnectDialogContainer } from "./oauth-connect-dialog-container";
import { ProviderPanelSheetContainer } from "./provider-panel-sheet-container";
import { AddProviderPanelContainer } from "./add-provider-panel-container";
import { DiscordConnectionCardContainer } from "./discord-connection-card-container";
import { useDiscordConnection } from "../../application/hooks/use-discord-connection";
import { SubscriptionWizard } from "../components/subscription-wizard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApiKeyProvider, ConnectionCategory, IntegrationProviderItem } from "../../domain/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AI_PROVIDERS = ["openai", "anthropic", "google", "zai", "xai"] as const;
const WORKSPACE_API_KEY_PROVIDERS = ["sentry", "posthog"] as const;

const WORKSPACE_CONNECTIONS_PARAMS = new URLSearchParams({
  scope: "organization",
});

const USER_CONNECTIONS_PARAMS = new URLSearchParams({
  scope: "user",
});

// ---------------------------------------------------------------------------
// Inner content - may use hooks that require Suspense (e.g. useSearchParams)
// ---------------------------------------------------------------------------

interface IntegrationsPageContentProps {
  categories?: ConnectionCategory[];
  title?: string;
  description?: string;
  showAiScopeControls?: boolean;
  showAiKeyPolicy?: boolean;
  showWorkspaceSelector?: boolean;
}

const DEFAULT_INTEGRATION_CATEGORIES: ConnectionCategory[] = ["deployment", "monitoring", "communication"];

const IntegrationsPageContent: React.FC<IntegrationsPageContentProps> = ({
  categories = DEFAULT_INTEGRATION_CATEGORIES,
  title = "Other Integrations",
  description = "Connect deployment, observability, and communication services to enhance your workspace.",
  showAiScopeControls,
  showAiKeyPolicy,
  showWorkspaceSelector = true,
}) => {
  const {
    providers,
    isLoading,
    aiScope,
    setAiScope,
    workspaces,
    activeWorkspaceId,
    isLoadingWorkspaces,
    isSwitchingWorkspace,
    onWorkspaceChange,
    handleConnect,
    handleManage,
    handleDisconnectProvider,
    apiKeyForm,
    oauthConnect,
    confirmDialogProps,
    providerPanelState,
    setProviderPanelState,
    subscriptionConnect,
    handleSubscriptionFromDialog,
  } = useIntegrationsPage();

  const accountPicker = useGitHubAccountPicker();
  const discordConnection = useDiscordConnection();
  const visibleCategories = new Set(categories);
  const visibleProviders = providers.filter((provider) => visibleCategories.has(provider.category));
  const includesAiProviders = visibleCategories.has("ai");
  const includesCommunicationProviders = visibleCategories.has("communication");
  const shouldShowAiScopeControls = showAiScopeControls ?? includesAiProviders;
  const shouldShowAiKeyPolicy = showAiKeyPolicy ?? includesAiProviders;

  // Fetch connections for the add-provider panel based on aiScope
  const { data: workspaceConnections } = useConnections(WORKSPACE_CONNECTIONS_PARAMS);
  const { data: userConnections } = useConnections(USER_CONNECTIONS_PARAMS);
  const connections = aiScope === "organization" ? workspaceConnections : userConnections;

  // Add provider panel for AI section
  const addProviderPanel = useAddProviderPanel({
    apiKeyForm,
    connections: connections ?? [],
    aiScope,
  });

  // Unified card click handler that decides the right action per provider
  const handleCardClick = useCallback(
    (item: IntegrationProviderItem) => {
      const { provider, isConnected, comingSoon } = item;

      // Coming soon providers: show informational toast
      if (comingSoon) {
        showToast.info(`${item.name} integration is coming soon!`);
        return;
      }

      // GitHub always opens the account picker
      if (provider === "github") {
        accountPicker.openDialog();
        return;
      }

      // AI providers: if connected, open the panel sheet; otherwise connect
      if ((AI_PROVIDERS as readonly string[]).includes(provider)) {
        if (isConnected) {
          handleManage(provider);
        } else {
          handleConnect(provider);
        }
        return;
      }

      // Vercel: if connected, show disconnect; otherwise start OAuth connect flow
      if (provider === "vercel") {
        if (isConnected && item.connections[0]) {
          handleDisconnectProvider(item.connections[0].id, "Vercel");
        } else {
          handleConnect(provider);
        }
        return;
      }

      // Workspace API-key providers (sentry, posthog)
      if ((WORKSPACE_API_KEY_PROVIDERS as readonly string[]).includes(provider)) {
        if (isConnected) {
          handleManage(provider);
        } else {
          handleConnect(provider);
        }
        return;
      }

      // Discord opens its own side panel
      if (provider === "discord") {
        discordConnection.openDialog();
        return;
      }

      // Fallback
      handleConnect(provider);
    },
    [accountPicker, discordConnection, handleConnect, handleDisconnectProvider, handleManage],
  );

  return (
    <div className="px-4 py-5 sm:p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {showWorkspaceSelector && (
          <WorkspaceSelector
            value={activeWorkspaceId}
            options={workspaces}
            isLoading={isLoadingWorkspaces}
            isSwitching={isSwitchingWorkspace}
            onChange={onWorkspaceChange}
          />
        )}
      </div>

      {shouldShowAiScopeControls && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            AI Key Scope
          </p>
          <AiScopeSelector value={aiScope} onChange={setAiScope} />
          <p className="text-xs text-muted-foreground">
            Applies only to AI providers. Code, deployment, observability, and communication providers are always connected at workspace level.
          </p>
        </div>
      )}

      <IntegrationsGrid
        providers={visibleProviders}
        isLoading={isLoading}
        onCardClick={handleCardClick}
        onAddProviderClick={addProviderPanel.open}
      />

      <ApiKeyConnectDialogContainer
        apiKeyForm={apiKeyForm}
        onSubscriptionClick={() => handleSubscriptionFromDialog()}
      />
      <OAuthConnectDialogContainer oauthConnect={oauthConnect} />
      <ProviderPanelSheetContainer
        panelState={providerPanelState}
        onOpenChange={(open) => !open && setProviderPanelState(null)}
        onAddKeyClick={() => {
          if (!providerPanelState) {
            return;
          }

          apiKeyForm.openForProvider(
            providerPanelState.provider as ApiKeyProvider,
            providerPanelState.scope,
          );
        }}
        onSubscriptionClick={() =>
          handleSubscriptionFromDialog(
            providerPanelState?.provider === "openai" || providerPanelState?.provider === "anthropic"
              ? providerPanelState.provider
              : undefined,
          )
        }
      />

      <Dialog
        open={subscriptionConnect.isActive}
        onOpenChange={(open) => !open && subscriptionConnect.reset()}
      >
        <DialogContent className="max-w-[540px]">
          <DialogTitle className="sr-only">
            {subscriptionConnect.provider === "anthropic"
              ? "Connect Claude Max subscription"
              : "Connect ChatGPT Pro subscription"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Complete the subscription connection flow to save usage-enabled credentials.
          </DialogDescription>
          <SubscriptionWizard
            provider={subscriptionConnect.provider}
            step={subscriptionConnect.step}
            tokenValue={subscriptionConnect.tokenValue}
            tokenError={subscriptionConnect.tokenError}
            isValidating={subscriptionConnect.isValidating}
            isValid={subscriptionConnect.isValid}
            connectionName={subscriptionConnect.connectionName}
            isSaving={subscriptionConnect.isSaving}
            onTokenChange={subscriptionConnect.handleTokenChange}
            onConnectionNameChange={subscriptionConnect.handleConnectionNameChange}
            onNext={subscriptionConnect.handleNext}
            onBack={subscriptionConnect.handleBack}
            onSave={() => subscriptionConnect.handleSave(aiScope)}
            onCancel={subscriptionConnect.reset}
            canUseCli={subscriptionConnect.canUseCli}
            cliCommand={subscriptionConnect.cliCommand}
            isPollingCli={subscriptionConnect.isPollingCli}
            cliError={subscriptionConnect.cliError}
            onStartCli={() => subscriptionConnect.startCliFlow(aiScope)}
            deviceCode={subscriptionConnect.deviceCode}
            deviceVerificationUrl={subscriptionConnect.deviceVerificationUrl}
            isPollingDevice={subscriptionConnect.isPollingDevice}
            deviceError={subscriptionConnect.deviceError}
          />
        </DialogContent>
      </Dialog>

      <AddProviderPanelContainer {...addProviderPanel} />
      {includesCommunicationProviders && <DiscordConnectionCardContainer discord={discordConnection} />}
      {shouldShowAiKeyPolicy && <AiKeyPolicyContainer />}
      <GitHubAccountPickerDialogContainer accountPicker={accountPicker} />

      <ConfirmDialog
        isOpen={confirmDialogProps.isOpen}
        options={confirmDialogProps.options}
        onConfirm={confirmDialogProps.handleConfirm}
        onCancel={confirmDialogProps.handleCancel}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Public container - wraps content in Suspense
// ---------------------------------------------------------------------------

export type IntegrationsPageContainerProps = IntegrationsPageContentProps;

export const IntegrationsPageContainer: React.FC<IntegrationsPageContainerProps> = (props) => (
  <Suspense>
    <IntegrationsPageContent {...props} />
  </Suspense>
);
