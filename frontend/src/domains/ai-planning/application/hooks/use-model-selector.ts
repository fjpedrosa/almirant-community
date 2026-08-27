"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useProviderKeysCompat as useProviderKeys } from "@/domains/integrations/application/hooks/use-provider-keys-compat";
import { useAiProviderPreference } from "@/domains/integrations/application/hooks/use-ai-provider-preference";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import {
  getModelsForAgentProvider,
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
    () => (providerKeys ?? []).filter((key) => key.isActive),
    [providerKeys],
  );

  // Effective coding agent: explicit user pick > project default > global default
  const effectiveCodingAgent = useMemo<CodingAgent>(
    () => userSelectedCodingAgent ?? options?.defaultCodingAgent ?? DEFAULT_CODING_AGENT,
    [userSelectedCodingAgent, options?.defaultCodingAgent],
  );

  const compatibleAgentProviders = useMemo(
    () => getProvidersForAgent(effectiveCodingAgent),
    [effectiveCodingAgent],
  );

  const compatibleAiProviders = useMemo(
    () => new Set<string>(compatibleAgentProviders.map(agentProviderToAiProvider)),
    [compatibleAgentProviders],
  );

  const compatibleKeys = useMemo(
    () => activeKeys.filter((key) => compatibleAiProviders.has(key.provider)),
    [activeKeys, compatibleAiProviders],
  );

  // Derive a key only from providers admitted for the effective coding agent.
  // Key identity is intentionally irrelevant to runtime compatibility.
  const selectedKeyId = useMemo(() => {
    if (userSelectedKeyId && compatibleKeys.some((key) => key.id === userSelectedKeyId)) {
      return userSelectedKeyId;
    }
    if (preferredKeyId && compatibleKeys.some((key) => key.id === preferredKeyId)) {
      return preferredKeyId;
    }
    return compatibleKeys[0]?.id ?? "";
  }, [userSelectedKeyId, preferredKeyId, compatibleKeys]);

  const selectedKey = useMemo(
    () => compatibleKeys.find((key) => key.id === selectedKeyId) ?? null,
    [compatibleKeys, selectedKeyId],
  );

  const selectedAgentProvider = useMemo(() => {
    if (!selectedKey) return null;
    return compatibleAgentProviders.find(
      (provider) => agentProviderToAiProvider(provider) === selectedKey.provider,
    ) ?? null;
  }, [compatibleAgentProviders, selectedKey]);

  const availableModelsWithMetadata = useMemo(() => {
    if (!selectedAgentProvider) return [];
    return getModelsForAgentProvider(effectiveCodingAgent, selectedAgentProvider);
  }, [effectiveCodingAgent, selectedAgentProvider]);

  // Legacy compatibility: return just the model IDs for backwards compatibility.
  const availableModels = useMemo(
    () => availableModelsWithMetadata.map((model) => model.id),
    [availableModelsWithMetadata],
  );

  // Never expose a stale or unsupported model for the effective runtime tuple.
  const selectedModel = useMemo(() => {
    if (userSelectedModel && availableModels.includes(userSelectedModel)) {
      return userSelectedModel;
    }
    return availableModels[0] ?? "";
  }, [userSelectedModel, availableModels]);

  // Keep the external preference aligned with the compatible key derived above.
  // Local user intent remains event-owned rather than synchronized by an effect.
  useEffect(() => {
    if (selectedKeyId && preferredKeyId !== selectedKeyId) {
      persistPreference(selectedKeyId);
    }
  }, [selectedKeyId, preferredKeyId, persistPreference]);

  const handleKeyChange = useCallback((keyId: string) => {
    setUserSelectedKeyId(keyId);
    setUserSelectedModel("");
    persistPreference(keyId);
  }, [persistPreference]);

  const handleModelChange = useCallback((model: string) => {
    if (!availableModels.includes(model)) return;
    setUserSelectedModel(model);
  }, [availableModels]);

  const handleCodingAgentChange = useCallback((agent: CodingAgent) => {
    setUserSelectedCodingAgent(agent);
    setUserSelectedModel("");
  }, []);

  const selectedModelMetadata = useMemo(() => {
    return availableModelsWithMetadata.find((model) => model.id === selectedModel) ?? null;
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
