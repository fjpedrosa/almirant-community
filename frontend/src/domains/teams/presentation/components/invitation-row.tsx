"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDistanceToNow } from "date-fns";
import type { InvitationRowProps } from "../../domain/types";

/**
 * A single invitation row showing email, role badge, status badge,
 * relative time, and an optional cancel button.
 *
 * Purely presentational.
 */
export const InvitationRow: React.FC<InvitationRowProps> = ({
  id,
  email,
  role,
  status,
  expiresAt,
  createdAt,
  canManage,
  onCancel,
}) => {
  const t = useTranslations("teams.invitations");

  const isExpired = new Date(expiresAt) < new Date();
  const effectiveStatus = status === "pending" && isExpired ? "expired" : status;

  const statusVariant = effectiveStatus === "pending" ? "secondary" : "outline";

  const roleLabel =
    role === "owner"
      ? t("roleOwner")
      : role === "admin"
        ? t("roleAdmin")
        : t("roleMember");

  const statusLabel =
    effectiveStatus === "expired"
      ? t("statusExpired")
      : t("statusPending");

  const relativeTime = formatDistanceToNow(new Date(createdAt), {
    addSuffix: true,
  });

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {/* Email */}
        <span className="min-w-0 truncate text-sm font-medium">{email}</span>

        {/* Role badge */}
        <Badge variant="outline" className="shrink-0 capitalize">
          {roleLabel}
        </Badge>

        {/* Status badge */}
        <Badge
          variant={statusVariant}
          className={
            effectiveStatus === "expired"
              ? "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-300"
              : ""
          }
        >
          {statusLabel}
        </Badge>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {/* Relative time */}
        <span className="text-muted-foreground text-xs">{relativeTime}</span>

        {/* Cancel button */}
        {canManage && effectiveStatus === "pending" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCancel(id)}
            aria-label={`${t("cancelInvitation")} ${email}`}
            className="text-destructive hover:text-destructive h-7 w-7 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};
