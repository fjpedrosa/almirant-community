"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import type {
  InviteMemberRequest,
  ResendInvitationRequest,
  UpdateMemberRoleRequest,
  RemoveMemberRequest,
} from "../../domain/types";
import { teamKeys } from "./use-teams";

// ──────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────

/**
 * Invite a new member to the active organisation by email.
 */
export const useInviteMember = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: InviteMemberRequest) => {
      const result = await authClient.organization.inviteMember({
        email: data.email,
        role: data.role,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Failed to invite member");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
};

/**
 * Resend a pending invitation email by re-inviting with `resend: true`.
 */
export const useResendInvitation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: ResendInvitationRequest) => {
      const result = await authClient.organization.inviteMember({
        email: data.email,
        role: data.role,
        resend: true,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Failed to resend invitation");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
};

/**
 * Remove a member (or cancel a pending invitation) from the active organisation.
 */
export const useRemoveMember = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: RemoveMemberRequest) => {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: data.memberIdOrEmail,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Failed to remove member");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
};

/**
 * Update the role of an existing member in the active organisation.
 */
export const useUpdateMemberRole = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateMemberRoleRequest) => {
      const result = await authClient.organization.updateMemberRole({
        memberId: data.memberId,
        role: data.role,
      });
      if (result.error) {
        throw new Error(
          result.error.message ?? "Failed to update member role",
        );
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
};
