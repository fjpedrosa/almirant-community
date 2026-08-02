"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { devFlowApi } from "@/lib/api/client";
import { parseMaxConcurrentJobsInput } from "../../domain/dev-flow";
import { buildDevFlowAutomationsPatchPayload, overridesByAutomationIdFromStatuses } from "../../domain/dev-flow-automation-overrides";
import type {
  ProjectDevFlowAutomationStatus,
  ProjectDevFlowConfigResponse,
  ProjectDevFlowPatchBody,
  ProjectDevFlowSettings,
  ProjectDevFlowSkippedAgent,
  ProjectImplementationAiProvider,
  ProjectImplementationCodingAgent,
} from "../../domain/types";
import { useProjectAiConfigQuery } from "./use-project-ai-config";
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

/**
 * Data + form-state hook for the "Automated dev flow" project settings card.
 * Fetches the current config (GET /projects/:id/dev-flow), tracks local
 * unsaved edits the same way the sibling `useProjectAiConfig` /
 * `useProjectNightlyValidation` hooks do, and saves through the isolated
 * `devFlowApi.updateConfig` (PATCH /projects/:id/ai-config). The save
 * response is treated as opaque — on success this just invalidates the
 * dev-flow query so the four automation rows always reflect the server's
 * authoritative provisioning result, rather than trying to parse whatever
 * shape the PATCH response happens to carry.
 */
export const useProjectDevFlow = (projectId: string) => {
  const queryClient = useQueryClient();

  const {
    data: serverConfig,
    isLoading: isLoadingDevFlow,
    error: queryError,
  } = useQuery({
    queryKey: projectKeys.devFlow(projectId),
    queryFn: async (): Promise<ProjectDevFlowConfigResponse> =>
      devFlowApi.getConfig(projectId),
    enabled: !!projectId,
  });

  // Review fixes #1+#2 (issue #235): PATCH /projects/:id/ai-config requires
  // `defaultProvider` and wholesale-replaces the entire `agentDefaults` JSONB
  // on every write — `implementation` lives in that SAME JSONB but is never
  // returned by GET /dev-flow, only by GET /ai-config. Reusing
  // `useProjectAiConfigQuery`'s query key means this shares the SAME cached
  // fetch as `useProjectAiConfig` when both are mounted on the settings page.
  const { data: aiConfig, isLoading: isLoadingAiConfig } = useProjectAiConfigQuery(projectId);
  const isLoading = isLoadingDevFlow || isLoadingAiConfig;

  const serverSettings = serverConfig?.devFlow ?? DEFAULT_DEV_FLOW_SETTINGS;
  const automations: ProjectDevFlowAutomationStatus[] = serverConfig?.automations ?? [];
  const skippedExistingUserAgents: ProjectDevFlowSkippedAgent[] =
    serverConfig?.skippedExistingUserAgents ?? [];

  const [localSettings, setLocalSettings] =
    useState<ProjectDevFlowSettings | null>(null);

  const settings = localSettings ?? serverSettings;

  const hasChanges = useMemo(
    () => localSettings !== null && !settingsEqual(localSettings, serverSettings),
    [localSettings, serverSettings],
  );

  const mutation = useMutation({
    mutationFn: (data: ProjectDevFlowSettings) => {
      // Fix 1+2: the FULL PATCH body — defaultProvider + implementation
      // (read from the ai-config query, never touched by this card) + this
      // card's devFlow scalars + every automation's CURRENT server-persisted
      // override (never touched by this hook either, so it must be resent
      // verbatim or the wholesale JSONB replace would silently wipe it out).
      const body: ProjectDevFlowPatchBody = {
        defaultProvider: aiConfig?.defaultProvider ?? null,
        agentDefaults: {
          implementation: aiConfig?.agentDefaults?.implementation,
          devFlow: {
            ...data,
            automations: buildDevFlowAutomationsPatchPayload(
              overridesByAutomationIdFromStatuses(automations),
            ),
          },
        },
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
    (codingAgent: ProjectImplementationCodingAgent) => patch({ codingAgent }),
    [patch],
  );

  const handleAiProviderChange = useCallback(
    (aiProvider: ProjectImplementationAiProvider) => patch({ aiProvider, model: null, reasoningLevel: null }),
    [patch],
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
    mutation.mutate(settings);
  }, [mutation, settings]);

  const handleDiscard = useCallback(() => {
    setLocalSettings(null);
  }, []);

  return {
    settings,
    // Server-persisted devFlow scalars, WITHOUT any unsaved local edit —
    // exposed so useDevFlowAutomationOverrides can build its own PATCH body
    // (Fix 1+2) without accidentally smuggling in this card's own unsaved
    // draft into an unrelated row-level save.
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
