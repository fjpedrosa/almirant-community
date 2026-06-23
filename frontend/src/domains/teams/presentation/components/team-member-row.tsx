import { useTranslations } from "next-intl";
import { MoreHorizontal, Shield, ShieldAlert, User, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TeamMemberRowProps, TeamRole } from "../../domain/types";

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const roleIcons: Record<TeamRole, React.FC<{ className?: string }>> = {
  owner: ShieldAlert,
  admin: Shield,
  member: User,
};

const roleVariants: Record<TeamRole, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  member: "outline",
};

export const TeamMemberRow: React.FC<TeamMemberRowProps> = ({
  memberId,
  name,
  email,
  image,
  role,
  isCurrentUser,
  canManageMembers,
  onRemove,
  onUpdateRole,
}) => {
  const t = useTranslations("teams");
  const RoleIcon = roleIcons[role];

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <Avatar className="size-9">
          {image && <AvatarImage src={image} alt={name} />}
          <AvatarFallback className="text-xs">
            {getInitials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {name}
            {isCurrentUser && (
              <span className="ml-1 text-xs text-muted-foreground">
                ({t("you")})
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant={roleVariants[role]} className="gap-1">
          <RoleIcon className="size-3" />
          {t(`roles.${role}`)}
        </Badge>

        {canManageMembers && !isCurrentUser && role !== "owner" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label={t("actions")}>
                <MoreHorizontal className="size-4" />
                <span className="sr-only">{t("actions")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("changeRole")}</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => onUpdateRole(memberId, "admin")}
                disabled={role === "admin"}
              >
                <Shield className="mr-2 size-4" />
                {t("roles.admin")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onUpdateRole(memberId, "member")}
                disabled={role === "member"}
              >
                <User className="mr-2 size-4" />
                {t("roles.member")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onRemove(memberId)}
              >
                <Trash2 className="mr-2 size-4" />
                {t("removeMember")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
};
