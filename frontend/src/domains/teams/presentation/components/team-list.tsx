import { useTranslations } from "next-intl";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TeamCard } from "./team-card";
import type { TeamListProps } from "../../domain/types";

export const TeamList: React.FC<TeamListProps> = ({
  teams,
  activeTeamId,
  isLoading,
  onSelectTeam,
  onCreateTeam,
}) => {
  const t = useTranslations("teams");

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed p-12 text-center">
        <Users className="size-10 text-muted-foreground" />
        <div>
          <p className="text-lg font-medium">{t("empty.title")}</p>
          <p className="text-sm text-muted-foreground">
            {t("empty.description")}
          </p>
        </div>
        <Button onClick={onCreateTeam}>
          <Plus className="mr-2 size-4" />
          {t("createTeam")}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {teams.map((team) => (
        <TeamCard
          key={team.id}
          id={team.id}
          name={team.name}
          slug={team.slug}
          logo={team.logo}
          memberCount={0}
          isActive={team.id === activeTeamId}
          onSelect={onSelectTeam}
        />
      ))}
    </div>
  );
};
