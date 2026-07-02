"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workspaceSettingsApi } from "@/lib/api/client";
import type {
  WorkspaceSettings,
  UpdateWorkspaceSettingsInput,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const orgSettingsKeys = {
  all: ["workspace-settings"] as const,
  detail: (orgId: string) => [...orgSettingsKeys.all, orgId] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Reads settings for the active workspace.
 * The backend resolves the workspace from the authenticated session,
 * so no explicit orgId parameter is needed for typical usage.
 */
export const useWorkspaceSettings = () => {
  return useQuery({
    queryKey: orgSettingsKeys.all,
    queryFn: () =>
      workspaceSettingsApi.get() as Promise<WorkspaceSettings>,
  });
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const useUpdateWorkspaceSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateWorkspaceSettingsInput) =>
      workspaceSettingsApi.update(data) as Promise<WorkspaceSettings>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orgSettingsKeys.all });
    },
  });
};
