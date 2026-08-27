"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { projectsApi } from "@/lib/api/client";
import {
  getDefaultProjectModel,
  getDefaultProjectRuntimeSelection,
  getProjectRuntimeCodingAgents,
  type ProjectRuntimeSelection,
} from "../../domain/project-runtime-selection";
import type {
  AiConfigProvider,
  ProjectAgentDefaults,
  ProjectAiConfig,
  ProjectImplementationAiProvider,
  ProjectImplementationCodingAgent,
} from "../../domain/types";
import { projectKeys } from "./use-projects";

type ImplementationRuntime = {
  codingAgent: string | null;
  aiProvider: string | null;
  model: string | null;
  reasoningLevel: string | null;
};

type ProjectAiConfigPatch = {
  defaultProvider?: AiConfigProvider | null;
  agentDefaults?: {
    implementation?: ProjectAgentDefaults["implementation"];
  };
};

const toImplementationRuntime = (
  value: ProjectAgentDefaults["implementation"],
): ImplementationRuntime => ({
  codingAgent: value?.codingAgent ?? null,
  aiProvider: value?.aiProvider ?? null,
  model: value?.model ?? null,
  reasoningLevel: value?.reasoningLevel ?? null,
});

const implementationRuntimeEqual = (
  a: ImplementationRuntime,
  b: ImplementationRuntime,
): boolean =>
  a.codingAgent === b.codingAgent &&
  a.aiProvider === b.aiProvider &&
  a.model === b.model &&
  a.reasoningLevel === b.reasoningLevel;

const withProvider = (
  codingAgent: ProjectImplementationCodingAgent,
  aiProvider: ProjectImplementationAiProvider,
): ImplementationRuntime => ({
  codingAgent,
  aiProvider,
  model: getDefaultProjectModel("implementation", codingAgent, aiProvider),
  reasoningLevel: null,
});

const providerToImplementationDefaults = (
  provider: string | null,
): ImplementationRuntime => {
  if (provider === "codex") {
    return toImplementationRuntime(
      getDefaultProjectRuntimeSelection("implementation", "codex"),
    );
  }
  if (provider === "zipu") return withProvider("opencode", "zai");
  if (provider === "grok") return withProvider("opencode", "xai");
  return toImplementationRuntime(
    getDefaultProjectRuntimeSelection("implementation", "claude-code"),
  );
};

/** Shared read-only query; every project settings hook uses the same cache key. */
export const useProjectAiConfigQuery = (projectId: string) =>
  useQuery({
    queryKey: projectKeys.aiConfig(projectId),
    queryFn: async (): Promise<ProjectAiConfig> => projectsApi.getAiConfig(projectId),
    enabled: !!projectId,
  });

export const useProjectAiConfig = (projectId: string) => {
  const queryClient = useQueryClient();
  const {
    data: serverConfig,
    isLoading,
    error: queryError,
  } = useProjectAiConfigQuery(projectId);

  const [localProvider, setLocalProvider] = useState<AiConfigProvider | null | undefined>(undefined);
  const [localImplementation, setLocalImplementation] = useState<ImplementationRuntime | undefined>(undefined);

  const serverProvider = serverConfig?.defaultProvider ?? null;
  const currentProvider = localProvider !== undefined ? localProvider : serverProvider;
  const hasPersistedImplementation = serverConfig !== undefined &&
    Object.prototype.hasOwnProperty.call(serverConfig.agentDefaults ?? {}, "implementation");
  const baseImplementation = hasPersistedImplementation
    ? toImplementationRuntime(serverConfig?.agentDefaults?.implementation)
    : providerToImplementationDefaults(currentProvider);
  const currentImplementationDefaults = localImplementation ?? baseImplementation;

  const providerChanged = localProvider !== undefined && localProvider !== serverProvider;
  const implementationChanged = localImplementation !== undefined &&
    !implementationRuntimeEqual(localImplementation, baseImplementation);
  const hasChanges = useMemo(
    () => providerChanged || implementationChanged,
    [implementationChanged, providerChanged],
  );

  const mutation = useMutation({
    mutationFn: (data: ProjectAiConfigPatch) => projectsApi.updateAiConfig(projectId, data),
    onSuccess: () => {
      setLocalProvider(undefined);
      setLocalImplementation(undefined);
      queryClient.invalidateQueries({ queryKey: projectKeys.aiConfig(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      showToast.success("AI configuration updated");
    },
    onError: (error) => {
      showToast.error(
        error instanceof Error ? error.message : "Failed to save AI configuration",
      );
    },
  });

  const errorMessage =
    queryError instanceof Error
      ? queryError.message
      : mutation.error instanceof Error
        ? mutation.error.message
        : null;

  // The legacy runner is an independent path. Changing it must never rewrite a
  // retained implementation tuple.
  const handleChange = useCallback((value: AiConfigProvider | null) => {
    setLocalProvider(value);
  }, []);

  const handleCodingAgentChange = useCallback(
    (codingAgent: ProjectImplementationCodingAgent) => {
      setLocalImplementation(
        toImplementationRuntime(
          getDefaultProjectRuntimeSelection("implementation", codingAgent),
        ),
      );
    },
    [],
  );

  const handleAiProviderChange = useCallback(
    (aiProvider: ProjectImplementationAiProvider) => {
      const codingAgent = currentImplementationDefaults.codingAgent;
      if (!getProjectRuntimeCodingAgents("implementation").some(
        (candidate) => candidate === codingAgent,
      )) return;
      setLocalImplementation(
        withProvider(codingAgent as ProjectImplementationCodingAgent, aiProvider),
      );
    },
    [currentImplementationDefaults.codingAgent],
  );

  const handleModelChange = useCallback(
    (model: string | null) => {
      setLocalImplementation({
        ...currentImplementationDefaults,
        model,
        reasoningLevel: null,
      });
    },
    [currentImplementationDefaults],
  );

  const handleReasoningLevelChange = useCallback(
    (reasoningLevel: string | null) => {
      setLocalImplementation({ ...currentImplementationDefaults, reasoningLevel });
    },
    [currentImplementationDefaults],
  );

  const handleSave = useCallback(() => {
    const patch: ProjectAiConfigPatch = {};
    if (providerChanged) patch.defaultProvider = currentProvider as AiConfigProvider | null;
    if (implementationChanged) {
      patch.agentDefaults = { implementation: currentImplementationDefaults };
    }
    if (Object.keys(patch).length > 0) mutation.mutate(patch);
  }, [
    currentImplementationDefaults,
    currentProvider,
    implementationChanged,
    mutation,
    providerChanged,
  ]);

  const handleDiscard = useCallback(() => {
    setLocalProvider(undefined);
    setLocalImplementation(undefined);
  }, []);

  return {
    defaultProvider: currentProvider,
    implementationDefaults: currentImplementationDefaults as ProjectRuntimeSelection,
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
