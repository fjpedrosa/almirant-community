import { useTranslations } from "next-intl";
import { UserPlus, Clock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamMemberRow } from "./team-member-row";
import type { TeamMemberListProps } from "../../domain/types";

export const TeamMemberList: React.FC<TeamMemberListProps> = ({
  members,
  invitations,
  currentUserId,
  isLoading,
  canInviteMembers,
  canManageMembers,
  canManageInvitations,
  onInvite,
  onRemoveMember,
  onUpdateRole,
  onCancelInvitation,
  onResendInvitation,
}) => {
  const t = useTranslations("teams");

  const pendingInvitations = invitations.filter((i) => i.status === "pending");

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("membersTitle")}</h2>
        {canInviteMembers && (
          <Button size="sm" onClick={onInvite}>
            <UserPlus className="mr-2 size-4" />
            {t("inviteMember")}
          </Button>
        )}
      </div>

      {/* Members list */}
      <div className="space-y-2">
        {members.map((member) => (
          <TeamMemberRow
            key={member.id}
            memberId={member.id}
            name={member.user.name}
            email={member.user.email}
            image={member.user.image}
            role={member.role}
            isCurrentUser={member.userId === currentUserId}
            canManageMembers={canManageMembers}
            onRemove={onRemoveMember}
            onUpdateRole={onUpdateRole}
          />
        ))}
      </div>

      {/* Pending invitations */}
      {pendingInvitations.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("pendingInvitations")} ({pendingInvitations.length})
          </h3>
          <div className="space-y-2">
            {pendingInvitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-dashed p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-full bg-muted">
                    <Mail className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {invitation.email}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      <span>{t("pending")}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{t(`roles.${invitation.role}`)}</Badge>
                  {canManageInvitations && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onResendInvitation(invitation.email, invitation.role)
                        }
                      >
                        {t("resendInvitation")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCancelInvitation(invitation.id)}
                      >
                        {t("cancelInvitation")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
