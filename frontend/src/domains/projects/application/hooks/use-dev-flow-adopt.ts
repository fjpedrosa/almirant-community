"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { devFlowApi } from "@/lib/api/client";
import type { ProjectDevFlowAdoptResult, ProjectDevFlowConfigResponse } from "../../domain/types";
import { projectKeys } from "./use-projects";

/**
 * Merges a successful adopt's response into the cached
 * `GET /projects/:id/dev-flow` payload: replaces the adopted row with the
 * server's returned `automation` (issue #235 — adopt forces `enabled: true`
 * on it directly in the config, independent of the card-level master
 * switch, so the row must reflect that real state immediately), and drops
 * the now-disabled user agent(s) from `skippedExistingUserAgents` so the
 * conflict banner/Adopt button for this row disappear without waiting for
 * the invalidated query to refetch.
 */
const applyAdoptResultToCache = (
  current: ProjectDevFlowConfigResponse | undefined,
  result: ProjectDevFlowAdoptResult,
): ProjectDevFlowConfigResponse | undefined => {
  if (!current) return current;

  return {
    ...current,
    automations: current.automations.map((automation) =>
      automation.automationId === result.automation.automationId ? result.automation : automation,
    ),
    skippedExistingUserAgents: current.skippedExistingUserAgents.filter(
      (skipped) => !result.disabledUserConfigIds.includes(skipped.configId),
    ),
  };
};

/**
 * "Adopt" mutation for a dev-flow automation row that is currently
 * `skippedForExistingUserAgent` (issue #235): POST
 * /projects/:id/dev-flow/adopt, which disables the user's hand-created
 * agent and turns on the system-managed automation instead.
 *
 * The inline "are you sure" confirmation itself is trivial, ephemeral UI
 * state (a per-row boolean) and lives directly in the presentational row
 * component — this hook only owns the actual network mutation and exposes
 * `isAdopting(automationId)` so the row can disable its confirm button
 * while the request is in flight.
 */
export const useDevFlowAdopt = (projectId: string) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (automationId: string) => devFlowApi.adoptAutomation(projectId, automationId),
    onSuccess: (data) => {
      queryClient.setQueryData<ProjectDevFlowConfigResponse>(projectKeys.devFlow(projectId), (current) =>
        applyAdoptResultToCache(current, data),
      );
      queryClient.invalidateQueries({ queryKey: projectKeys.devFlow(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.aiConfig(projectId) });
      showToast.success("Adopted — your existing agent has been turned off");
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Failed to adopt automation");
    },
  });

  const handleAdopt = useCallback(
    (automationId: string) => {
      mutation.mutate(automationId);
    },
    [mutation],
  );

  const isAdopting = useCallback(
    (automationId: string) => mutation.isPending && mutation.variables === automationId,
    [mutation.isPending, mutation.variables],
  );

  return { handleAdopt, isAdopting };
};
