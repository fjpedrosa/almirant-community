import { useTranslations } from "next-intl";
import { ArrowLeft, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { TeamDetailHeaderProps } from "../../domain/types";

const getTeamInitials = (name: string): string =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

export const TeamDetailHeader: React.FC<TeamDetailHeaderProps> = ({
  name,
  slug,
  logo,
  memberCount,
  canEditTeam,
  canDeleteTeam,
  onEdit,
  onDelete,
  onBack,
}) => {
  const t = useTranslations("teams");

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label={t("back")}>
          <ArrowLeft className="size-4" />
          <span className="sr-only">{t("back")}</span>
        </Button>

        <Avatar className="size-12">
          {logo && <AvatarImage src={logo} alt={name} />}
          <AvatarFallback className="text-lg">
            {getTeamInitials(name)}
          </AvatarFallback>
        </Avatar>

        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{slug}</span>
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              {memberCount} {t("members")}
            </span>
          </div>
        </div>
      </div>

      {(canEditTeam || canDeleteTeam) && (
        <div className="flex items-center gap-2">
          {canEditTeam && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="mr-2 size-4" />
              {t("editTeam")}
            </Button>
          )}
          {canDeleteTeam && (
            <Button variant="outline" size="sm" onClick={onDelete}>
              <Trash2 className="mr-2 size-4" />
              {t("deleteTeam")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
