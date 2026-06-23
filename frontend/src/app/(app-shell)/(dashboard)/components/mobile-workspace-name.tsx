"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";

const getInitials = (name: string): string =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

/**
 * Mobile-only component that displays the active workspace name in the sidebar header.
 * Shows avatar + workspace name without switching functionality (switching is via avatar dropdown).
 */
export const MobileWorkspaceName: React.FC = () => {
  const { activeTeam, isLoading } = useActiveTeam();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
        <Skeleton className="size-5 rounded-full" />
        <Skeleton className="h-4 w-20" />
      </div>
    );
  }

  if (!activeTeam) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
      <Avatar className="size-5">
        {activeTeam.logo && (
          <AvatarImage src={activeTeam.logo} alt={activeTeam.name} />
        )}
        <AvatarFallback className="text-[10px]">
          {getInitials(activeTeam.name)}
        </AvatarFallback>
      </Avatar>
      <span className="text-xs text-muted-foreground font-medium truncate max-w-[200px]">
        {activeTeam.name}
      </span>
    </div>
  );
};
