"use client";

import { useTranslations } from "next-intl";
import { InvitationRow } from "./invitation-row";
import type { InvitationListProps } from "../../domain/types";

/**
 * Renders a list of pending team invitations.
 *
 * If no invitations are present, shows an empty-state message.
 * Purely presentational.
 *
 * @example
 * <InvitationList
 *   invitations={pendingInvitations}
 *   canManage={isAdmin}
 *   onCancel={handleCancelInvitation}
 * />
 */
export const InvitationList: React.FC<InvitationListProps> = ({
  invitations,
  canManage,
  onCancel,
}) => {
  const t = useTranslations("teams.invitations");

  if (invitations.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-center text-sm">
        {t("noPending")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {invitations.map((invitation) => (
        <InvitationRow
          key={invitation.id}
          id={invitation.id}
          email={invitation.email}
          role={invitation.role}
          status={invitation.status}
          expiresAt={invitation.expiresAt}
          createdAt={invitation.createdAt}
          canManage={canManage}
          onCancel={onCancel}
        />
      ))}
    </div>
  );
};
