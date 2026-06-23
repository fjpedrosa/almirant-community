"use client";

import { useState } from "react";
import { useCurrentUserTeams } from "../../application/hooks/use-current-user-teams";
import { useActiveTeam } from "../../application/hooks/use-active-team";
import { TeamSwitcher } from "../components/team-switcher";

export const TeamSwitcherContainer: React.FC = () => {
  const [open, setOpen] = useState(false);
  const { teams, isLoading: isLoadingTeams } = useCurrentUserTeams();
  const { activeTeamId, isLoading: isLoadingActive, setActiveTeam } =
    useActiveTeam();

  return (
    <TeamSwitcher
      teams={teams}
      activeTeamId={activeTeamId}
      isLoading={isLoadingTeams || isLoadingActive}
      onSelectTeam={setActiveTeam}
      open={open}
      onOpenChange={setOpen}
    />
  );
};
