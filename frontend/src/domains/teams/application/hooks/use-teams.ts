"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { serviceAccountsApi, boardsApi } from "@/lib/api/client";
import type { CreateTeamRequest, UpdateTeamRequest, Team } from "../../domain/types";

// ──────────────────────────────────────────────
// Query key factory
// ──────────────────────────────────────────────

export const teamKeys = {
  all: ["teams"] as const,
  lists: () => [...teamKeys.all, "list"] as const,
  details: () => [...teamKeys.all, "detail"] as const,
  detail: (id: string) => [...teamKeys.details(), id] as const,
  members: (id: string) => [...teamKeys.detail(id), "members"] as const,
};

// ──────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────

/**
 * List all organisations the current user belongs to.
 */
export const useTeams = () => {
  return useQuery({
    queryKey: teamKeys.lists(),
    queryFn: async (): Promise<Team[]> => {
      const result = await authClient.organization.list();
      if (result.error) {
        throw new Error(result.error.message ?? "Failed to list teams");
      }
      return (result.data ?? []) as Team[];
    },
  });
};

// ──────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────

/**
 * Create a new organisation (team).
 */
export const useCreateTeam = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTeamRequest) => {
      const result = await authClient.organization.create({
        name: data.name,
        slug: data.slug ?? data.name.toLowerCase().replace(/\s+/g, "-"),
        logo: data.logo,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Failed to create team");
      }
      return result.data as Team;
    },
    onSuccess: (team) => {
      queryClient.invalidateQueries({ queryKey: teamKeys.lists() });

      // Best-effort: provision a default runner service account for the new org
      if (team?.id) {
        serviceAccountsApi.provision(team.id).catch((err) => {
          console.error("[teams] Failed to provision default service account", err);
        });

        // Best-effort: provision a default "Desarrollo" board for the new org
        boardsApi.provision().catch((err) => {
          console.error("[teams] Failed to provision default board", err);
        });
      }
    },
  });
};

/**
 * Update an existing organisation (team).
 */
export const useUpdateTeam = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      data,
    }: {
      data: UpdateTeamRequest;
    }) => {
      const result = await authClient.organization.update({
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.slug !== undefined && { slug: data.slug }),
          ...(data.logo !== undefined && { logo: data.logo }),
        },
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Failed to update team");
      }
      return result.data as Team;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
};

/**
 * Delete an organisation (team).
 */
export const useDeleteTeam = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (organizationId: string) => {
      const result = await authClient.organization.delete({
        organizationId,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Failed to delete team");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
};

/**
 * Set the active organisation on the session. This scopes subsequent
 * API calls and navigation to the chosen team.
 */
export const useSetActiveTeam = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (organizationId: string) => {
      const result = await authClient.organization.setActive({
        organizationId,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Failed to set active team");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
};
