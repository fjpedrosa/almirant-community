import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MemberAvatarGroupProps } from "../../domain/types";

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const sizeClasses = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
} as const;

const overlapClasses = {
  sm: "-ml-2",
  md: "-ml-3",
} as const;

export const MemberAvatarGroup: React.FC<MemberAvatarGroupProps> = ({
  users,
  max = 3,
  size = "md",
}) => {
  const visible = users.slice(0, max);
  const remaining = users.length - max;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center">
        {visible.map((user, index) => (
          <Tooltip key={`${user.name}-${index}`}>
            <TooltipTrigger asChild>
              <Avatar
                className={`${sizeClasses[size]} border-2 border-background ${index > 0 ? overlapClasses[size] : ""}`}
              >
                {user.image && (
                  <AvatarImage src={user.image} alt={user.name} />
                )}
                <AvatarFallback className={sizeClasses[size]}>
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{user.name}</p>
            </TooltipContent>
          </Tooltip>
        ))}
        {remaining > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={`${sizeClasses[size]} ${overlapClasses[size]} flex items-center justify-center rounded-full border-2 border-background bg-muted font-medium text-muted-foreground`}
              >
                +{remaining}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>
                {users
                  .slice(max)
                  .map((u) => u.name)
                  .join(", ")}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
};
