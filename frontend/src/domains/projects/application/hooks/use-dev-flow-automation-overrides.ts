"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { devFlowApi } from "@/lib/api/client";
import {
  EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
  buildDevFlowAutomationOverrideDirtyPatch,
  devFlowAutomationOverridesEqual,
  normalizeDevFlowAutomationOverride,
} from "../../domain/dev-flow-automation-overrides";
import type { DevFlowAutomationDraftEntry } from "../../domain/dev-flow-automation-overrides";
import {
  getDefaultProjectModel,
  getDefaultProjectRuntimeSelection,
  getProjectRuntimeCodingAgents,
} from "../../domain/project-runtime-selection";
import type {
  DevFlowAutomationOverridePatchWire,
  ProjectDevFlowAutomationOverride,
  ProjectDevFlowAutomationOverridableField,
  ProjectDevFlowAutomationSchedule,
  ProjectDevFlowAutomationStatus,
  ProjectDevFlowPatchBody,
  ProjectDevFlowSettings,
  ProjectImplementationAiProvider,
  ProjectImplementationCodingAgent,
} from "../../domain/types";
import { projectKeys } from "./use-projects";

interface AutomationMutationInput {
  automationId: string;
  patch: DevFlowAutomationOverridePatchWire;
}

/** Per-automation drafts with omission-aware, one-row PATCH writes. */
const useDevFlowAutomationOverridesImplementation = (
  projectId: string,
  automations: ProjectDevFlowAutomationStatus[],
) => {
  const queryClient = useQueryClient();
  const [draftsByAutomationId, setDraftsByAutomationId] = useState<
    Record<string, ProjectDevFlowAutomationOverride>
  >({});

  const serverOverrideFor = useCallback(
    (automationId: string): ProjectDevFlowAutomationOverride =>
      automations.find((automation) => automation.automationId === automationId)?.overrides ??
      EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
    [automations],
  );

  const mutation = useMutation({
    mutationFn: ({ automationId, patch }: AutomationMutationInput) => {
      const body: ProjectDevFlowPatchBody = {
        agentDefaults: {
          devFlow: {
            automations: { [automationId]: patch },
          },
        },
      };
      return devFlowApi.updateAutomationOverrides(projectId, body);
    },
    onSuccess: (_data, variables) => {
      setDraftsByAutomationId((current) => {
        const next = { ...current };
        delete next[variables.automationId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: projectKeys.devFlow(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.aiConfig(projectId) });
      showToast.success("Automation updated");
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Failed to save automation");
    },
  });

  const drafts: Record<string, DevFlowAutomationDraftEntry> = useMemo(() => {
    const result: Record<string, DevFlowAutomationDraftEntry> = {};
    for (const automationId of Object.keys(draftsByAutomationId)) {
      const draft = draftsByAutomationId[automationId]!;
      const server = serverOverrideFor(automationId);
      result[automationId] = {
        override: draft,
        hasChanges: !devFlowAutomationOverridesEqual(draft, server),
        isSaving:
          mutation.isPending && mutation.variables?.automationId === automationId,
      };
    }
    return result;
  }, [draftsByAutomationId, mutation.isPending, mutation.variables, serverOverrideFor]);

  const handleFieldChange = useCallback(
    (
      automationId: string,
      field: ProjectDevFlowAutomationOverridableField,
      value: boolean | string | number | null,
    ) => {
      const automation = automations.find((item) => item.automationId === automationId);
      if (!automation) return;

      setDraftsByAutomationId((current) => {
        const base = current[automationId] ?? serverOverrideFor(automationId);
        const effective = automation.effective;
        let next: ProjectDevFlowAutomationOverride;

        if (field === "codingAgent" && typeof value === "string") {
          const runtime = getDefaultProjectRuntimeSelection(
            automation.automationId,
            value as ProjectImplementationCodingAgent,
          );
          next = { ...base, ...runtime };
        } else if (field === "aiProvider" && typeof value === "string") {
          const codingAgent = base.codingAgent ?? effective.codingAgent;
          if (!getProjectRuntimeCodingAgents(automation.automationId).some(
            (candidate) => candidate === codingAgent,
          )) return current;
          next = {
            ...base,
            aiProvider: value,
            model: getDefaultProjectModel(
              automation.automationId,
              codingAgent,
              value as ProjectImplementationAiProvider,
            ),
            reasoningLevel: null,
          };
        } else {
          next = { ...base, [field]: value };
          if (field === "model" || field === "reasoningLevel") {
            next = normalizeDevFlowAutomationOverride(next, effective);
          }
        }

        return { ...current, [automationId]: next };
      });
    },
    [automations, serverOverrideFor],
  );

  const handleScheduleChange = useCallback(
    (automationId: string, schedule: ProjectDevFlowAutomationSchedule | null) => {
      setDraftsByAutomationId((current) => ({
        ...current,
        [automationId]: {
          ...(current[automationId] ?? serverOverrideFor(automationId)),
          schedule,
        },
      }));
    },
    [serverOverrideFor],
  );

  const handleDiscard = useCallback((automationId: string) => {
    setDraftsByAutomationId((current) => {
      const next = { ...current };
      delete next[automationId];
      return next;
    });
  }, []);

  const handleSave = useCallback(
    (automationId: string) => {
      const server = serverOverrideFor(automationId);
      const draft = draftsByAutomationId[automationId] ?? server;
      mutation.mutate({
        automationId,
        patch: buildDevFlowAutomationOverrideDirtyPatch(draft, server),
      });
    },
    [draftsByAutomationId, mutation, serverOverrideFor],
  );

  const handleResetToDefaults = useCallback(
    (automationId: string) => {
      mutation.mutate({
        automationId,
        patch: buildDevFlowAutomationOverrideDirtyPatch(
          EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
          serverOverrideFor(automationId),
        ),
      });
    },
    [mutation, serverOverrideFor],
  );

  return {
    drafts,
    isLoading: false,
    handleFieldChange,
    handleScheduleChange,
    handleSave,
    handleDiscard,
    handleResetToDefaults,
  };
};

export const useDevFlowAutomationOverrides: (
  projectId: string,
  automations: ProjectDevFlowAutomationStatus[],
  cardSettings: ProjectDevFlowSettings,
) => ReturnType<typeof useDevFlowAutomationOverridesImplementation> =
  useDevFlowAutomationOverridesImplementation;
