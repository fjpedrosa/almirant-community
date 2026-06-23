"use client";

import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { InvitationList } from "./invitation-list";
import { InviteMemberDialog } from "./invite-member-dialog";
import type { InvitationsSectionProps } from "../../domain/types";

/**
 * Self-contained section that combines:
 * - a header with "Pending invitations" title + invite button (if canManage)
 * - the invitation list
 * - the invite-member dialog
 *
 * Designed to be easily dropped into a team-detail container or page.
 * Purely presentational -- all state is controlled via props.
 *
 * @example
 * <InvitationsSection
 *   invitations={pendingInvitations}
 *   canManage={isAdmin}
 *   isInviteDialogOpen={form.isOpen}
 *   inviteEmail={form.email}
 *   inviteRole={form.role}
 *   isInviting={form.isPending}
 *   isInviteFormValid={form.isFormValid}
 *   inviteEmailError={form.emailError}
 *   onOpenInviteDialog={form.handleOpen}
 *   onCloseInviteDialog={form.handleClose}
 *   onInviteEmailChange={form.handleEmailChange}
 *   onInviteRoleChange={form.handleRoleChange}
 *   onInviteSubmit={form.handleSubmit}
 *   onCancelInvitation={handleCancelInvitation}
 * />
 */
export const InvitationsSection: React.FC<InvitationsSectionProps> = ({
  invitations,
  canManage,
  isInviteDialogOpen,
  inviteEmail,
  inviteRole,
  isInviting,
  isInviteFormValid,
  inviteEmailError,
  onOpenInviteDialog,
  onCloseInviteDialog,
  onInviteEmailChange,
  onInviteRoleChange,
  onInviteSubmit,
  onCancelInvitation,
}) => {
  const t = useTranslations("teams.invitations");

  return (
    <section aria-labelledby="invitations-heading">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 id="invitations-heading" className="text-sm font-semibold">
          {t("title")}
          {invitations.length > 0 && (
            <span className="text-muted-foreground ml-1.5 font-normal">
              ({invitations.length})
            </span>
          )}
        </h3>

        {canManage && (
          <Button variant="outline" size="sm" onClick={onOpenInviteDialog}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            {t("invite")}
          </Button>
        )}
      </div>

      {/* Invitation list */}
      <InvitationList
        invitations={invitations}
        canManage={canManage}
        onCancel={onCancelInvitation}
      />

      {/* Invite dialog */}
      <InviteMemberDialog
        isOpen={isInviteDialogOpen}
        email={inviteEmail}
        role={inviteRole}
        isSubmitting={isInviting}
        isFormValid={isInviteFormValid}
        emailError={inviteEmailError}
        onEmailChange={onInviteEmailChange}
        onRoleChange={onInviteRoleChange}
        onSubmit={onInviteSubmit}
        onClose={onCloseInviteDialog}
      />
    </section>
  );
};
