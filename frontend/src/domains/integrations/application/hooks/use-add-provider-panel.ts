"use client";

import { useState, useMemo, useCallback } from "react";
import type {
  ApiKeyProvider,
  ProviderType,
  UseAddProviderPanelParams,
  UseAddProviderPanelReturn,
} from "../../domain/types";
import { AVAILABLE_PROVIDERS, AI_PROVIDERS } from "./use-integrations-page";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the state of the add-provider panel for AI integrations.
 *
 * - Filters available AI providers that are not yet connected
 * - Delegates to the correct connection dialog (API key or OAuth)
 *
 * @example
 * const addProviderPanel = useAddProviderPanel({
 *   apiKeyForm,
 *   connections: workspaceConnections ?? [],
 *   aiScope,
 * });
 *
 * // In JSX:
 * <AddProviderPanel
 *   isOpen={addProviderPanel.isOpen}
 *   onClose={addProviderPanel.close}
 *   providers={addProviderPanel.availableProviders}
 *   onSelectProvider={addProviderPanel.handleSelectProvider}
 * />
 */
export const useAddProviderPanel = ({
  apiKeyForm,
  connections,
  aiScope,
}: UseAddProviderPanelParams): UseAddProviderPanelReturn => {
  const [isOpen, setIsOpen] = useState(false);

  // Get the set of connected AI provider types
  const connectedProviders = useMemo(() => {
    const connected = new Set<ProviderType>();
    for (const connection of connections) {
      if (connection.isActive && AI_PROVIDERS.includes(connection.provider)) {
        connected.add(connection.provider);
      }
    }
    return connected;
  }, [connections]);

  // Filter AI providers that are not connected
  const availableProviders = useMemo(() => {
    return AVAILABLE_PROVIDERS.filter(
      (provider) =>
        provider.category === "ai" && !connectedProviders.has(provider.provider)
    );
  }, [connectedProviders]);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleSelectProvider = useCallback(
    (provider: ProviderType) => {
      // Close the panel first
      setIsOpen(false);

      // AI providers use API key connection
      if (AI_PROVIDERS.includes(provider)) {
        apiKeyForm.openForProvider(provider as ApiKeyProvider, aiScope);
      }
      // Note: Currently all AI providers use API keys.
      // If OAuth-based AI providers are added in the future,
      // extend this logic similar to handleConnect in use-integrations-page.ts
    },
    [apiKeyForm, aiScope]
  );

  return {
    isOpen,
    availableProviders,
    open,
    close,
    handleSelectProvider,
  };
};
