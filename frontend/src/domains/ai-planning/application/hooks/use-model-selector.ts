"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useProviderKeysCompat as useProviderKeys } from "@/domains/integrations/application/hooks/use-provider-keys-compat";
import { useAiProviderPreference } from "@/domains/integrations/application/hooks/use-ai-provider-preference";
import { getModelsForProvider } from "@/lib/ai-models-catalog";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import {
  getProvidersForAgent,
  agentProviderToAiProvider,
} from "@/domains/agents/domain/coding-agent-compatibility";

const DEFAULT_CODING_AGENT: CodingAgent = "claude-code";

interface UseModelSelectorOptions {
  /** Project-level default coding agent (overrides the global default). */
  defaultCodingAgent?: CodingAgent;
}

export const useModelSelector = (options?: UseModelSelectorOptions) => {
  const { data: providerKeys, isLoading } = useProviderKeys();
  const {
    selectedKeyId: preferredKeyId,
    setSelectedKeyId: persistPreference,
  } = useAiProviderPreference();
  const [userSelectedKeyId, setUserSelectedKeyId] = useState<string>("");
  const [userSelectedModel, setUserSelectedModel] = useState<string>("");
  const [userSelectedCodingAgent, setUserSelectedCodingAgent] = useState<CodingAgent | null>(null);

  const activeKeys = useMemo(
    () => (providerKeys ?? []).filter((k) => k.isActive),
    [providerKeys],
  );

  // Effective coding agent: explicit user pick > project default > global default
  const effectiveCodingAgent = useMemo<CodingAgent>(
    () => userSelectedCodingAgent ?? options?.defaultCodingAgent ?? DEFAULT_CODING_AGENT,
    [userSelectedCodingAgent, options?.defaultCodingAgent],
  );

  // Auto-select a compatible provider key for the effective coding agent.
  // Only runs once per agent value (or when keys load), without overriding
  // an explicit user key selection.
  const lastAutoAgentRef = useRef<CodingAgent | null>(null);
  useEffect(() => {
    if (effectiveCodingAgent === lastAutoAgentRef.current) return;
    if (activeKeys.length === 0) return;

    lastAutoAgentRef.current = effectiveCodingAgent;

    // Check if the current preferred key is already compatible
    const compatibleAiProviders = getProvidersForAgent(effectiveCodingAgent).map(agentProviderToAiProvider);
    const currentKey = activeKeys.find((k) => k.id === (userSelectedKeyId || preferredKeyId));
    if (currentKey && compatibleAiProviders.includes(currentKey.provider)) return;

    // Pick the first compatible key
    const compatibleKeys = activeKeys.filter((k) => compatibleAiProviders.includes(k.provider));
    if (compatibleKeys.length > 0) {
      setUserSelectedKeyId(compatibleKeys[0].id);
      persistPreference(compatibleKeys[0].id);
      setUserSelectedModel("");
    }
  }, [effectiveCodingAgent, activeKeys, userSelectedKeyId, preferredKeyId, persistPreference]);

  // Derive effective key: user selection > localStorage preference > first active
  const selectedKeyId = useMemo(() => {
    if (userSelectedKeyId) return userSelectedKeyId;
    if (preferredKeyId && activeKeys.some((k) => k.id === preferredKeyId)) {
      return preferredKeyId;
    }
    return activeKeys[0]?.id ?? "";
  }, [userSelectedKeyId, preferredKeyId, activeKeys]);

  const selectedKey = useMemo(
    () => activeKeys.find((k) => k.id === selectedKeyId) ?? null,
    [activeKeys, selectedKeyId],
  );

  // Get models with full metadata for the selected provider
  const availableModelsWithMetadata = useMemo(() => {
    if (!selectedKey) return [];
    return getModelsForProvider(selectedKey.provider);
  }, [selectedKey]);

  // Legacy compatibility: return just the model IDs for backwards compatibility
  const availableModels = useMemo(() => {
    return availableModelsWithMetadata.map(model => model.id);
  }, [availableModelsWithMetadata]);

  // Derive effective model: user selection > first model for auto-selected key
  const selectedModel = useMemo(() => {
    if (userSelectedModel) return userSelectedModel;
    return availableModels[0] ?? "";
  }, [userSelectedModel, availableModels]);

  const handleKeyChange = useCallback((keyId: string) => {
    setUserSelectedKeyId(keyId);
    setUserSelectedModel("");
    persistPreference(keyId);
  }, [persistPreference]);

  const handleModelChange = useCallback((model: string) => {
    setUserSelectedModel(model);
  }, []);

  const handleCodingAgentChange = useCallback((agent: CodingAgent) => {
    setUserSelectedCodingAgent(agent);
  }, []);

  // Get metadata for currently selected model
  const selectedModelMetadata = useMemo(() => {
    return availableModelsWithMetadata.find(model => model.id === selectedModel) ?? null;
  }, [availableModelsWithMetadata, selectedModel]);

  return {
    providerKeys: activeKeys,
    isLoading,
    selectedKeyId,
    selectedModel,
    selectedKey,
    availableModels,
    availableModelsWithMetadata,
    selectedModelMetadata,
    hasKeys: activeKeys.length > 0,
    handleKeyChange,
    handleModelChange,
    selectedCodingAgent: effectiveCodingAgent as CodingAgent | undefined,
    handleCodingAgentChange,
  };
};
