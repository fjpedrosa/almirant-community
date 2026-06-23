"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { useTeamDetail } from "./use-team-detail";
import { teamKeys } from "./use-teams";
import type { TeamInvitation } from "../../domain/types";

// ──────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────

/**
 * Derives the pending invitations from the team detail query.
 *
 * Filters invitations to only return those with `status === "pending"`.
 */
export const useTeamInvitations = (teamId: string) => {
  const { data: teamDetail, isLoading, error } = useTeamDetail(teamId);

  const invitations = teamDetail?.invitations;
  const pendingInvitations: TeamInvitation[] = useMemo(() => {
    if (!invitations) return [];
    return invitations.filter((inv) => inv.status === "pending");
  }, [invitations]);

  return {
    invitations: pendingInvitations,
    isLoading,
    error,
  };
};

// ──────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────

/**
 * Cancel a pending invitation by its ID.
 */
export const useCancelInvitation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string) => {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      });
      if (result.error) {
        throw new Error(
          result.error.message ?? "Failed to cancel invitation",
        );
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
};
