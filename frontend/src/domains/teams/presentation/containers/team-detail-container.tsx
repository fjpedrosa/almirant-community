"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import {
  useDeleteTeam,
} from "../../application/hooks/use-teams";
import { useTeamDetail } from "../../application/hooks/use-team-detail";
import {
  useRemoveMember,
  useResendInvitation,
  useUpdateMemberRole,
} from "../../application/hooks/use-team-members";
import { useTeamForm } from "../../application/hooks/use-team-form";
import { useInviteMemberForm } from "../../application/hooks/use-invite-member-form";
import { TeamDetailHeader } from "../components/team-detail-header";
import { TeamMemberList } from "../components/team-member-list";
import { TeamFormDialog } from "../components/team-form-dialog";
import { InviteMemberDialog } from "../components/invite-member-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { sendMemberRemovedEmail } from "../../application/actions/send-member-removed-email";
import type { TeamRole } from "../../domain/types";

interface TeamDetailContainerProps {
  teamId: string;
}

export const TeamDetailContainer: React.FC<TeamDetailContainerProps> = ({
  teamId,
}) => {
  const t = useTranslations("teams");
  const router = useRouter();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;

  const { data: teamDetail, isLoading } = useTeamDetail(teamId);
  const deleteTeam = useDeleteTeam();
  const removeMember = useRemoveMember();
  const resendInvitation = useResendInvitation();
  const updateMemberRole = useUpdateMemberRole();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const confirmDialog = useConfirmDialog();

  // Edit form
  const handleCloseEditDialog = useCallback(() => {
    setEditDialogOpen(false);
  }, []);

  const {
    form: editForm,
    isPending: isEditPending,
    onSubmit: onEditSubmit,
    generateSlug,
  } = useTeamForm(handleCloseEditDialog, teamDetail ?? null);

  const editNameValue = editForm.watch("name");
  const editSlugValue = editForm.watch("slug");

  const existingEmails = useMemo(() => {
    if (!teamDetail) return [];
    const memberEmails = teamDetail.members.map((member) => member.user.email);
    const invitationEmails = teamDetail.invitations
      .filter((invitation) => invitation.status === "pending")
      .map((invitation) => invitation.email);
    return [...memberEmails, ...invitationEmails];
  }, [teamDetail]);

  const currentMemberRole = useMemo<TeamRole | null>(() => {
    if (!teamDetail || !currentUserId) return null;
    return (
      teamDetail.members.find((member) => member.userId === currentUserId)?.role ?? null
    );
  }, [teamDetail, currentUserId]);

  const canManageMembers =
    currentMemberRole === "owner" || currentMemberRole === "admin";
  const canManageInvitations = canManageMembers;
  const canInviteMembers = canManageMembers;
  const canEditTeam =
    currentMemberRole === "owner" || currentMemberRole === "admin";
  const canDeleteTeam = currentMemberRole === "owner";

  const inviteForm = useInviteMemberForm(existingEmails);

  const handleBack = useCallback(() => {
    router.push("/teams");
  }, [router]);

  const handleEdit = useCallback(() => {
    if (!canEditTeam) return;
    if (teamDetail) {
      editForm.reset({ name: teamDetail.name, slug: teamDetail.slug });
    }
    setEditDialogOpen(true);
  }, [canEditTeam, teamDetail, editForm]);

  const handleDelete = useCallback(() => {
    if (!canDeleteTeam || !teamDetail) return;
    deleteTeam.mutate(teamDetail.id, {
      onSuccess: () => {
        showToast.success("Team deleted");
        router.push("/teams");
      },
      onError: (error) => {
        showToast.error(error.message);
      },
    });
  }, [canDeleteTeam, teamDetail, deleteTeam, router]);

  const handleRemoveMember = useCallback(
    async (memberIdOrEmail: string) => {
      if (!canManageMembers) return;
      const member = teamDetail?.members.find((m) => m.id === memberIdOrEmail);
      const memberName = member?.user.name ?? memberIdOrEmail;
      const memberEmail = member?.user.email ?? "";

      const confirmed = await confirmDialog.confirm({
        title: `Remove ${memberName}?`,
        description: memberEmail
          ? `This will remove ${memberName} (${memberEmail}) from the organization. This action cannot be undone.`
          : `This will remove ${memberName} from the organization. This action cannot be undone.`,
        variant: "destructive",
      });

      if (!confirmed) return;

      removeMember.mutate(
        { memberIdOrEmail },
        {
          onSuccess: () => {
            showToast.success("Member removed");
            // Send removal notification email (fire-and-forget)
            if (member) {
              sendMemberRemovedEmail({
                email: member.user.email,
                memberName: member.user.name,
                organizationName: teamDetail?.name ?? "",
              }).catch(() => {});
            }
          },
          onError: (error) => {
            showToast.error(error.message);
          },
        },
      );
    },
    [canManageMembers, removeMember, teamDetail, confirmDialog],
  );

  const handleUpdateRole = useCallback(
    (memberId: string, role: TeamRole) => {
      if (!canManageMembers) return;
      updateMemberRole.mutate(
        { memberId, role },
        {
          onSuccess: () => {
            showToast.success("Role updated");
          },
          onError: (error) => {
            showToast.error(error.message);
          },
        },
      );
    },
    [canManageMembers, updateMemberRole],
  );

  const handleCancelInvitation = useCallback(
    (invitationId: string) => {
      if (!canManageInvitations) return;
      removeMember.mutate(
        { memberIdOrEmail: invitationId },
        {
          onSuccess: () => {
            showToast.success("Invitation cancelled");
          },
          onError: (error) => {
            showToast.error(error.message);
          },
        },
      );
    },
    [canManageInvitations, removeMember],
  );

  const handleResendInvitation = useCallback(
    (email: string, role: TeamRole) => {
      if (!canManageInvitations) return;
      resendInvitation.mutate(
        { email, role },
        {
          onSuccess: () => {
            showToast.success(t("invitationResent", { email }));
          },
          onError: (error) => {
            showToast.error(error.message || t("resendInvitationError"));
          },
        },
      );
    },
    [canManageInvitations, resendInvitation, t],
  );

  const handleInvite = useCallback(() => {
    if (!canInviteMembers) return;
    inviteForm.handleOpen();
  }, [canInviteMembers, inviteForm]);

  const handleEditNameChange = useCallback(
    (value: string) => {
      editForm.setValue("name", value, { shouldValidate: true });
      const currentSlug = editForm.getValues("slug");
      if (!currentSlug || currentSlug === generateSlug(editNameValue)) {
        editForm.setValue("slug", generateSlug(value));
      }
    },
    [editForm, generateSlug, editNameValue],
  );

  const handleEditSlugChange = useCallback(
    (value: string) => {
      editForm.setValue("slug", value);
    },
    [editForm],
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!teamDetail) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-muted-foreground">Team not found</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <TeamDetailHeader
        name={teamDetail.name}
        slug={teamDetail.slug}
        logo={teamDetail.logo}
        memberCount={teamDetail.members.length}
        canEditTeam={canEditTeam}
        canDeleteTeam={canDeleteTeam}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onBack={handleBack}
      />

      <TeamMemberList
        members={teamDetail.members}
        invitations={teamDetail.invitations}
        currentUserId={currentUserId}
        isLoading={false}
        canInviteMembers={canInviteMembers}
        canManageMembers={canManageMembers}
        canManageInvitations={canManageInvitations}
        onInvite={handleInvite}
        onRemoveMember={handleRemoveMember}
        onUpdateRole={handleUpdateRole}
        onCancelInvitation={handleCancelInvitation}
        onResendInvitation={handleResendInvitation}
      />

      {/* Edit dialog */}
      <TeamFormDialog
        isOpen={editDialogOpen}
        name={editNameValue}
        slug={editSlugValue ?? ""}
        isSubmitting={isEditPending}
        onNameChange={handleEditNameChange}
        onSlugChange={handleEditSlugChange}
        onSubmit={onEditSubmit}
        onClose={handleCloseEditDialog}
      />

      <InviteMemberDialog
        isOpen={inviteForm.isOpen}
        email={inviteForm.email ?? ""}
        role={inviteForm.role}
        isSubmitting={inviteForm.isPending}
        isFormValid={inviteForm.isFormValid}
        emailError={inviteForm.emailError}
        onEmailChange={inviteForm.handleEmailChange}
        onRoleChange={inviteForm.handleRoleChange}
        onSubmit={inviteForm.handleSubmit}
        onClose={inviteForm.handleClose}
      />

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        options={confirmDialog.options}
        onConfirm={confirmDialog.handleConfirm}
        onCancel={confirmDialog.handleCancel}
      />
    </div>
  );
};
