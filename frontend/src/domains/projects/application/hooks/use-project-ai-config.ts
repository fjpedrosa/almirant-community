"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { projectsApi } from "@/lib/api/client";
import type {
  AiConfigProvider,
  ProjectAgentDefaults,
  ProjectAiConfig,
  ProjectImplementationAiProvider,
  ProjectImplementationCodingAgent,
} from "../../domain/types";
import { projectKeys } from "./use-projects";

const providerToImplementationDefaults = (
  provider: AiConfigProvider | null,
): NonNullable<ProjectAgentDefaults["implementation"]> => {
  if (provider === "codex") return { codingAgent: "codex", aiProvider: "openai", model: "gpt-5.5", reasoningLevel: null };
  if (provider === "zipu") return { codingAgent: "opencode", aiProvider: "zai", model: "glm-5.1", reasoningLevel: null };
  if (provider === "grok") return { codingAgent: "opencode", aiProvider: "xai", model: "grok-4.20-reasoning", reasoningLevel: null };
  return { codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8", reasoningLevel: null };
};

const defaultModelForAiProvider = (aiProvider: ProjectImplementationAiProvider): string => {
  if (aiProvider === "openai") return "gpt-5.5";
  if (aiProvider === "zai") return "glm-5.1";
  if (aiProvider === "xai") return "grok-4.20-reasoning";
  return "claude-opus-4-8";
};

export const useProjectAiConfig = (projectId: string) => {
  const queryClient = useQueryClient();

  const {
    data: serverConfig,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: projectKeys.aiConfig(projectId),
    queryFn: async (): Promise<ProjectAiConfig> => projectsApi.getAiConfig(projectId),
    enabled: !!projectId,
  });

  const [localProvider, setLocalProvider] = useState<AiConfigProvider | null | undefined>(undefined);
  const [localAgentDefaults, setLocalAgentDefaults] = useState<ProjectAgentDefaults | undefined>(undefined);

  const currentProvider = localProvider !== undefined ? localProvider : (serverConfig?.defaultProvider ?? null);
  const currentAgentDefaults = localAgentDefaults ?? serverConfig?.agentDefaults ?? {};
  const currentImplementationDefaults = currentAgentDefaults.implementation ?? providerToImplementationDefaults(currentProvider);

  const hasChanges = useMemo(() => {
    if (!serverConfig) return false;
    const providerChanged = localProvider !== undefined && localProvider !== serverConfig.defaultProvider;
    const defaultsChanged = localAgentDefaults !== undefined && JSON.stringify(localAgentDefaults) !== JSON.stringify(serverConfig.agentDefaults ?? {});
    return providerChanged || defaultsChanged;
  }, [localAgentDefaults, localProvider, serverConfig]);

  const mutation = useMutation({
    mutationFn: (data: Partial<ProjectAiConfig>) => projectsApi.updateAiConfig(projectId, data),
    onSuccess: () => {
      setLocalProvider(undefined);
      setLocalAgentDefaults(undefined);
      queryClient.invalidateQueries({ queryKey: projectKeys.aiConfig(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      showToast.success("AI configuration updated");
    },
    onError: (error) => {
      showToast.error(
        error instanceof Error ? error.message : "Failed to save AI configuration"
      );
    },
  });

  const errorMessage =
    queryError instanceof Error
      ? queryError.message
      : mutation.error instanceof Error
        ? mutation.error.message
        : null;

  const handleChange = useCallback((value: AiConfigProvider | null) => {
    setLocalProvider(value);
    setLocalAgentDefaults((current) => ({
      ...(current ?? serverConfig?.agentDefaults ?? {}),
      implementation: providerToImplementationDefaults(value),
    }));
  }, [serverConfig?.agentDefaults]);

  const handleImplementationDefaultChange = useCallback((patch: Partial<NonNullable<ProjectAgentDefaults["implementation"]>>) => {
    setLocalAgentDefaults((current) => {
      const base = current ?? serverConfig?.agentDefaults ?? {};
      return {
        ...base,
        implementation: {
          ...(base.implementation ?? providerToImplementationDefaults(currentProvider)),
          ...patch,
        },
      };
    });
  }, [currentProvider, serverConfig?.agentDefaults]);

  const handleCodingAgentChange = useCallback((codingAgent: ProjectImplementationCodingAgent) => {
    if (codingAgent === "codex") {
      handleImplementationDefaultChange({ codingAgent, aiProvider: "openai", model: "gpt-5.5", reasoningLevel: null });
    } else if (codingAgent === "opencode") {
      handleImplementationDefaultChange({ codingAgent, aiProvider: "zai", model: "glm-5.1", reasoningLevel: null });
    } else {
      handleImplementationDefaultChange({ codingAgent, aiProvider: "anthropic", model: "claude-opus-4-8", reasoningLevel: null });
    }
  }, [handleImplementationDefaultChange]);

  const handleAiProviderChange = useCallback((aiProvider: ProjectImplementationAiProvider) => {
    handleImplementationDefaultChange({
      aiProvider,
      model: defaultModelForAiProvider(aiProvider),
      reasoningLevel: null,
    });
  }, [handleImplementationDefaultChange]);

  const handleModelChange = useCallback((model: string | null) => {
    handleImplementationDefaultChange({ model });
  }, [handleImplementationDefaultChange]);

  const handleReasoningLevelChange = useCallback((reasoningLevel: string | null) => {
    handleImplementationDefaultChange({ reasoningLevel });
  }, [handleImplementationDefaultChange]);

  const handleSave = useCallback(() => {
    mutation.mutate({
      defaultProvider: currentProvider,
      agentDefaults: currentAgentDefaults,
    });
  }, [currentAgentDefaults, currentProvider, mutation]);

  const handleDiscard = useCallback(() => {
    setLocalProvider(undefined);
    setLocalAgentDefaults(undefined);
  }, []);

  return {
    defaultProvider: currentProvider,
    implementationDefaults: currentImplementationDefaults,
    isLoading,
    isSaving: mutation.isPending,
    hasChanges,
    errorMessage,
    handleChange,
    handleCodingAgentChange,
    handleAiProviderChange,
    handleModelChange,
    handleReasoningLevelChange,
    handleSave,
    handleDiscard,
  };
};
