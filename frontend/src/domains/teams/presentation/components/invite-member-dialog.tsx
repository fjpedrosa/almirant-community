"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import type { InviteMemberDialogProps } from "../../domain/types";

/**
 * Dialog for inviting a new member to the team.
 *
 * Purely presentational -- all state and handlers are passed via props.
 *
 * @example
 * <InviteMemberDialog
 *   isOpen={isOpen}
 *   email={email}
 *   role={role}
 *   isSubmitting={isPending}
 *   isFormValid={isFormValid}
 *   emailError={emailError}
 *   onEmailChange={handleEmailChange}
 *   onRoleChange={handleRoleChange}
 *   onSubmit={handleSubmit}
 *   onClose={handleClose}
 * />
 */
export const InviteMemberDialog: React.FC<InviteMemberDialogProps> = ({
  isOpen,
  email,
  role,
  isSubmitting,
  isFormValid,
  emailError,
  onEmailChange,
  onRoleChange,
  onSubmit,
  onClose,
}) => {
  const t = useTranslations("teams.invitations");
  const tc = useTranslations("common");

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("inviteTitle")}</DialogTitle>
          <DialogDescription>{t("inviteDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Email field */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-email">{t("emailLabel")} *</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "invite-email-error" : undefined}
              autoFocus
            />
            {emailError && (
              <p
                id="invite-email-error"
                className="text-destructive text-sm"
                role="alert"
              >
                {emailError}
              </p>
            )}
          </div>

          {/* Role selector */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-role">{t("roleLabel")}</Label>
            <Select value={role} onValueChange={onRoleChange}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{t("roleMember")}</SelectItem>
                <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                <SelectItem value="owner">{t("roleOwner")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {tc("cancel")}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || !isFormValid}
          >
            {isSubmitting ? t("sending") : t("sendInvitation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
