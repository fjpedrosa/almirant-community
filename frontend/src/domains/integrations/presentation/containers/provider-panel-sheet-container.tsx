"use client";

import React, { useCallback } from "react";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { useProviderPanel } from "../../application/hooks/use-provider-panel";
import { useReconnectFlow } from "../../application/hooks/use-reconnect-flow";
import { deriveIntegrationConnectionStatus } from "../../domain/connection-status";
import { ProviderPanelSheet } from "../components/provider-panel-sheet";
import { ReconnectDialog } from "../components/reconnect-dialog";
import type {
  ProviderPanelState,
  ProviderType,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Provider name map
// ---------------------------------------------------------------------------

const PROVIDER_NAMES: Record<ProviderType, string> = {
  github: "GitHub",
  vercel: "Vercel",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI",
  zai: "z.ai",
  xai: "xAI",
  sentry: "Sentry",
  posthog: "PostHog",
  zipu: "z.ai",
  discord: "Discord",
  gitlab: "GitLab",
};

// ---------------------------------------------------------------------------
// Props interface
// ---------------------------------------------------------------------------

export interface ProviderPanelSheetContainerProps {
  panelState: ProviderPanelState | null;
  onOpenChange: (open: boolean) => void;
  onAddKeyClick: () => void;
  onSubscriptionClick?: () => void;
}

// ---------------------------------------------------------------------------
// Container component
// ---------------------------------------------------------------------------

export const ProviderPanelSheetContainer: React.FC<
  ProviderPanelSheetContainerProps
> = ({ panelState, onOpenChange, onAddKeyClick, onSubscriptionClick }) => {
  const hook = useProviderPanel(panelState);
  const reconnectFlow = useReconnectFlow();

  const handleReconnect = useCallback(
    (connectionId: string) => {
      const conn = hook.connections.find((c) => c.id === connectionId);
      if (!conn || !panelState) return;
      reconnectFlow.open(connectionId, conn.name, panelState.provider);
    },
    [hook.connections, panelState, reconnectFlow],
  );

  // Derive values needed before any early returns (rules of hooks)
  const primaryConnection = panelState
    ? (hook.connections.find((c) => c.isActive) ?? hook.connections[0])
    : undefined;

  if (!panelState) return null;

  const status = deriveIntegrationConnectionStatus(primaryConnection);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      hook.resetState();
      onOpenChange(false);
    }
  };

  return (
    <>
      <ProviderPanelSheet
        open={!!panelState}
        onOpenChange={handleOpenChange}
        provider={panelState.provider}
        providerName={PROVIDER_NAMES[panelState.provider]}
        status={status}
        scope={panelState.scope}
        connections={hook.connections}
        isLoadingConnections={hook.isLoadingConnections}
        connectionCount={hook.connectionCount}
        availableModels={hook.availableModels}
        modelSettings={hook.modelSettings}
        hasModelChanges={hook.hasModelChanges}
        isSavingModelSettings={hook.isSavingModelSettings}
        onModelSettingChange={hook.handleModelSettingChange}
        onSaveModelSettings={hook.handleSaveModelSettings}
        isModelsSectionExpanded={hook.isModelsSectionExpanded}
        onModelsSectionExpandedChange={hook.setModelsSectionExpanded}
        defaultConnectionId={hook.defaultConnection?.id ?? null}
        editingConnectionId={hook.editingConnectionId}
        editName={hook.editName}
        editToken={hook.editToken}
        isSavingEdit={hook.isSavingEdit}
        onStartEdit={hook.handleStartEdit}
        onCancelEdit={hook.handleCancelEdit}
        onSaveEdit={hook.handleSaveEdit}
        onSetEditName={hook.setEditName}
        onSetEditToken={hook.setEditToken}
        onSetDefault={hook.handleSetDefault}
        onDeleteKey={hook.handleDeleteKey}
        onTestKey={hook.handleTestKey}
        onAddKeyClick={onAddKeyClick}
        testingStates={hook.testingStates}
        testResults={hook.testResults}
        onMovePriorityUp={hook.handleMovePriorityUp}
        onMovePriorityDown={hook.handleMovePriorityDown}
        isReordering={hook.isReordering}
        onToggleOrchestration={hook.handleToggleOrchestration}
        onReconnect={handleReconnect}
        showSubscriptionOption={
          panelState.provider === "anthropic" || panelState.provider === "openai"
        }
        onSubscriptionClick={onSubscriptionClick}
      />

      <ConfirmDialog
        isOpen={hook.confirmDialog.isOpen}
        options={hook.confirmDialog.options}
        onConfirm={hook.confirmDialog.handleConfirm}
        onCancel={hook.confirmDialog.handleCancel}
      />

      <ReconnectDialog
        open={reconnectFlow.isOpen}
        onOpenChange={(open) => { if (!open) reconnectFlow.close(); }}
        connectionId={reconnectFlow.connectionId ?? ""}
        connectionName={reconnectFlow.connectionName}
        provider={reconnectFlow.provider ?? "anthropic"}
        oauthState={reconnectFlow.oauthState}
        isStartingOAuth={reconnectFlow.isStartingOAuth}
        onStartOAuth={reconnectFlow.startOAuth}
        oauthCodeValue={reconnectFlow.oauthCodeValue}
        onOAuthCodeChange={reconnectFlow.setOAuthCodeValue}
        isSubmittingOAuthCode={reconnectFlow.isSubmittingOAuthCode}
        onSubmitOAuthCode={reconnectFlow.submitOAuthCode}
        setupTokenValue={reconnectFlow.setupTokenValue}
        onSetupTokenChange={reconnectFlow.setSetupTokenValue}
        isSubmittingSetupToken={reconnectFlow.isSubmittingSetupToken}
        onSubmitSetupToken={reconnectFlow.submitSetupToken}
        error={reconnectFlow.error}
      />
    </>
  );
};
