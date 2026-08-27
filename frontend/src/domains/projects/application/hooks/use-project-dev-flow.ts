"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { devFlowApi } from "@/lib/api/client";
import { parseMaxConcurrentJobsInput } from "../../domain/dev-flow";
import {
  getDefaultProjectModel,
  getDefaultProjectRuntimeSelection,
  getProjectRuntimeCodingAgents,
} from "../../domain/project-runtime-selection";
import type {
  ProjectDevFlowAutomationStatus,
  ProjectDevFlowConfigResponse,
  ProjectDevFlowPatchBody,
  ProjectDevFlowSettings,
  ProjectDevFlowSettingsPatch,
  ProjectDevFlowSkippedAgent,
  ProjectImplementationAiProvider,
  ProjectImplementationCodingAgent,
} from "../../domain/types";
import { projectKeys } from "./use-projects";

const DEFAULT_DEV_FLOW_SETTINGS: ProjectDevFlowSettings = {
  enabled: false,
  codingAgent: null,
  aiProvider: null,
  model: null,
  reasoningLevel: null,
  maxConcurrentJobs: null,
};

const settingsEqual = (
  a: ProjectDevFlowSettings,
  b: ProjectDevFlowSettings,
): boolean =>
  a.enabled === b.enabled &&
  a.codingAgent === b.codingAgent &&
  a.aiProvider === b.aiProvider &&
  a.model === b.model &&
  a.reasoningLevel === b.reasoningLevel &&
  a.maxConcurrentJobs === b.maxConcurrentJobs;

const buildDevFlowSettingsDirtyPatch = (
  draft: ProjectDevFlowSettings,
  server: ProjectDevFlowSettings,
): ProjectDevFlowSettingsPatch => {
  const patch: ProjectDevFlowSettingsPatch = {};
  if (draft.enabled !== server.enabled) patch.enabled = draft.enabled;
  if (draft.codingAgent !== server.codingAgent) patch.codingAgent = draft.codingAgent;
  if (draft.aiProvider !== server.aiProvider) patch.aiProvider = draft.aiProvider;
  if (draft.model !== server.model) patch.model = draft.model;
  if (draft.reasoningLevel !== server.reasoningLevel) {
    patch.reasoningLevel = draft.reasoningLevel;
  }
  if (draft.maxConcurrentJobs !== server.maxConcurrentJobs) {
    patch.maxConcurrentJobs = draft.maxConcurrentJobs;
  }
  return patch;
};

/** Data and omission-aware form state for the project dev-flow defaults card. */
export const useProjectDevFlow = (projectId: string) => {
  const queryClient = useQueryClient();
  const {
    data: serverConfig,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: projectKeys.devFlow(projectId),
    queryFn: async (): Promise<ProjectDevFlowConfigResponse> =>
      devFlowApi.getConfig(projectId),
    enabled: !!projectId,
  });

  const serverSettings = serverConfig?.devFlow ?? DEFAULT_DEV_FLOW_SETTINGS;
  const automations: ProjectDevFlowAutomationStatus[] = serverConfig?.automations ?? [];
  const skippedExistingUserAgents: ProjectDevFlowSkippedAgent[] =
    serverConfig?.skippedExistingUserAgents ?? [];
  const [localSettings, setLocalSettings] = useState<ProjectDevFlowSettings | null>(null);
  const settings = localSettings ?? serverSettings;

  const hasChanges = useMemo(
    () => localSettings !== null && !settingsEqual(localSettings, serverSettings),
    [localSettings, serverSettings],
  );

  const mutation = useMutation({
    mutationFn: (devFlow: ProjectDevFlowSettingsPatch) => {
      const body: ProjectDevFlowPatchBody = {
        agentDefaults: { devFlow },
      };
      return devFlowApi.updateConfig(projectId, body);
    },
    onSuccess: () => {
      setLocalSettings(null);
      queryClient.invalidateQueries({ queryKey: projectKeys.devFlow(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.aiConfig(projectId) });
      showToast.success("Automated dev flow updated");
    },
    onError: (error) => {
      showToast.error(
        error instanceof Error ? error.message : "Failed to save automated dev flow",
      );
    },
  });

  const errorMessage =
    queryError instanceof Error
      ? queryError.message
      : mutation.error instanceof Error
        ? mutation.error.message
        : null;

  const patch = useCallback(
    (fields: Partial<ProjectDevFlowSettings>) => {
      setLocalSettings((current) => ({
        ...(current ?? serverSettings),
        ...fields,
      }));
    },
    [serverSettings],
  );

  const handleToggleEnabled = useCallback(
    (enabled: boolean) => patch({ enabled }),
    [patch],
  );

  const handleCodingAgentChange = useCallback(
    (codingAgent: ProjectImplementationCodingAgent) => {
      const runtime = getDefaultProjectRuntimeSelection("dev-flow-default", codingAgent);
      patch(runtime);
    },
    [patch],
  );

  const handleAiProviderChange = useCallback(
    (aiProvider: ProjectImplementationAiProvider) => {
      const codingAgent = settings.codingAgent;
      if (!getProjectRuntimeCodingAgents("dev-flow-default").some(
        (candidate) => candidate === codingAgent,
      )) return;
      patch({
        aiProvider,
        model: getDefaultProjectModel("dev-flow-default", codingAgent, aiProvider),
        reasoningLevel: null,
      });
    },
    [patch, settings.codingAgent],
  );

  const handleModelChange = useCallback(
    (model: string | null) => patch({ model, reasoningLevel: null }),
    [patch],
  );

  const handleReasoningLevelChange = useCallback(
    (reasoningLevel: string | null) => patch({ reasoningLevel }),
    [patch],
  );

  const handleMaxConcurrentJobsChange = useCallback(
    (raw: string) => patch({ maxConcurrentJobs: parseMaxConcurrentJobsInput(raw) }),
    [patch],
  );

  const handleSave = useCallback(() => {
    const dirtyPatch = buildDevFlowSettingsDirtyPatch(settings, serverSettings);
    if (Object.keys(dirtyPatch).length > 0) mutation.mutate(dirtyPatch);
  }, [mutation, serverSettings, settings]);

  const handleDiscard = useCallback(() => {
    setLocalSettings(null);
  }, []);

  return {
    settings,
    serverSettings,
    automations,
    skippedExistingUserAgents,
    isLoading,
    isSaving: mutation.isPending,
    hasChanges,
    errorMessage,
    handleToggleEnabled,
    handleCodingAgentChange,
    handleAiProviderChange,
    handleModelChange,
    handleReasoningLevelChange,
    handleMaxConcurrentJobsChange,
    handleSave,
    handleDiscard,
  };
};
