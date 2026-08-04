"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { devFlowApi } from "@/lib/api/client";
import {
  EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
  buildDevFlowAutomationsPatchPayload,
  devFlowAutomationOverridesEqual,
  normalizeDevFlowAutomationOverride,
} from "../../domain/dev-flow-automation-overrides";
import type { DevFlowAutomationDraftEntry } from "../../domain/dev-flow-automation-overrides";
import type {
  DevFlowAutomationOverridePatchWire,
  ProjectDevFlowAutomationOverride,
  ProjectDevFlowAutomationOverridableField,
  ProjectDevFlowAutomationSchedule,
  ProjectDevFlowAutomationStatus,
  ProjectDevFlowPatchBody,
  ProjectDevFlowSettings,
} from "../../domain/types";
import { useProjectAiConfigQuery } from "./use-project-ai-config";
import { projectKeys } from "./use-projects";

/**
 * Per-automation override draft + save/reset for the "Automated dev flow"
 * card's expandable rows (issue #235). Sibling to `useProjectDevFlow`
 * (which owns the card-level master switch/defaults) — this hook only
 * tracks each row's own runtime/schedule override.
 *
 * IMPORTANT — the backend does a WHOLESALE REPLACE of the whole
 * `agentDefaults.devFlow.automations` map on every PATCH, not a per-key
 * merge. So `handleSave`/`handleResetToDefaults` never send just the edited
 * automationId's entry: they build the payload from every automation's
 * CURRENT desired override (its unsaved draft if any, otherwise its
 * server-persisted `overrides`) via `buildDevFlowAutomationsPatchPayload`.
 * Sending only the touched row would silently wipe out every other row's
 * persisted override. Automations with no override at all (fully inherited)
 * are naturally omitted by that function — that's also how a full row reset
 * is expressed (the caller forces that one entry to
 * `EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE` before building the payload).
 *
 * Since a save/reset can persist OTHER rows' unsaved drafts too (they ride
 * along in the same wholesale payload), a successful mutation clears every
 * staged draft, not just the one whose button was clicked — and every row
 * with a staged draft shows `isSaving: true` while the shared mutation is
 * in flight.
 */
export const useDevFlowAutomationOverrides = (
  projectId: string,
  automations: ProjectDevFlowAutomationStatus[],
  // Server-persisted card-level devFlow scalars (issue #235 review, Fix
  // 1+2) — pass `useProjectDevFlow`'s `serverSettings`, NEVER its
  // local-draft-merged `settings`: a row save must never accidentally
  // smuggle in an unrelated, unsaved edit to the master switch/defaults from
  // a completely different hook.
  cardSettings: ProjectDevFlowSettings,
) => {
  const queryClient = useQueryClient();
  const [draftsByAutomationId, setDraftsByAutomationId] = useState<
    Record<string, ProjectDevFlowAutomationOverride>
  >({});

  // Fix 1+2: PATCH /projects/:id/ai-config requires `defaultProvider` and
  // wholesale-replaces the entire `agentDefaults` JSONB on every write —
  // `implementation` lives in that SAME JSONB but isn't part of the
  // `automations` array this hook is handed. Reusing
  // `useProjectAiConfigQuery`'s query key means this shares the SAME cached
  // fetch as `useProjectDevFlow`/`useProjectAiConfig` when mounted together.
  const { data: aiConfig, isLoading } = useProjectAiConfigQuery(projectId);

  const serverOverrideFor = useCallback(
    (automationId: string): ProjectDevFlowAutomationOverride => {
      const automation = automations.find((item) => item.automationId === automationId);
      return normalizeDevFlowAutomationOverride(
        automation?.overrides ?? EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
        automation?.effective,
      );
    },
    [automations],
  );

  // Every known automation's CURRENT desired override (draft-or-server),
  // keyed by automationId — the full "form state" the wholesale payload is
  // built from.
  const currentOverridesByAutomationId = useCallback((): Record<string, ProjectDevFlowAutomationOverride> => {
    const result: Record<string, ProjectDevFlowAutomationOverride> = {};
    for (const automation of automations) {
      result[automation.automationId] = draftsByAutomationId[automation.automationId] ?? serverOverrideFor(automation.automationId);
    }
    return result;
  }, [automations, draftsByAutomationId, serverOverrideFor]);

  const mutation = useMutation({
    mutationFn: (automationsPayload: Record<string, DevFlowAutomationOverridePatchWire>) => {
      // Fix 1+2: the FULL PATCH body — defaultProvider + implementation
      // (read from the ai-config query, never touched by this hook) + the
      // card's server-persisted devFlow scalars (never touched by this hook
      // either — see the `cardSettings` param doc above) + the automations
      // map this hook actually owns.
      const body: ProjectDevFlowPatchBody = {
        defaultProvider: aiConfig?.defaultProvider ?? null,
        agentDefaults: {
          implementation: aiConfig?.agentDefaults?.implementation,
          devFlow: {
            ...cardSettings,
            automations: automationsPayload,
          },
        },
      };
      return devFlowApi.updateAutomationOverrides(projectId, body);
    },
    onSuccess: () => {
      // Everything currently staged was just included in the wholesale
      // payload and persisted — clear every draft, not just the row whose
      // Save/Reset button triggered this.
      setDraftsByAutomationId({});
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
        // Any staged draft rides along in the same wholesale payload as
        // whichever row's Save/Reset button was clicked, so it's "saving" too.
        isSaving: mutation.isPending,
      };
    }
    return result;
  }, [draftsByAutomationId, serverOverrideFor, mutation.isPending]);

  const handleFieldChange = useCallback(
    (
      automationId: string,
      field: ProjectDevFlowAutomationOverridableField,
      value: boolean | string | number | null,
    ) => {
      setDraftsByAutomationId((current) => ({
        ...current,
        [automationId]: normalizeDevFlowAutomationOverride({
          ...(current[automationId] ?? serverOverrideFor(automationId)),
          [field]: value,
        }, automations.find((item) => item.automationId === automationId)?.effective),
      }));
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
    (_automationId: string) => {
      // The edited automationId's own current draft is already included by
      // currentOverridesByAutomationId() — no special-casing needed here,
      // the whole point is every row's current state goes in together.
      const payload = buildDevFlowAutomationsPatchPayload(currentOverridesByAutomationId());
      mutation.mutate(payload);
    },
    [currentOverridesByAutomationId, mutation],
  );

  const handleResetToDefaults = useCallback(
    (automationId: string) => {
      const overridesByAutomationId = currentOverridesByAutomationId();
      overridesByAutomationId[automationId] = EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE;
      const payload = buildDevFlowAutomationsPatchPayload(overridesByAutomationId);
      mutation.mutate(payload);
    },
    [currentOverridesByAutomationId, mutation],
  );

  return {
    drafts,
    // True while the ai-config data this hook's save body depends on
    // (defaultProvider/implementation) hasn't loaded yet. In practice the
    // card already gates rendering every row behind useProjectDevFlow's own
    // (combined) isLoading, and both hooks share the same query cache, so by
    // the time a Save/Reset button is reachable this is already false —
    // exposed mainly for callers/tests that mount this hook on its own.
    isLoading,
    handleFieldChange,
    handleScheduleChange,
    handleSave,
    handleDiscard,
    handleResetToDefaults,
  };
};
