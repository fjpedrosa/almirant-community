import {
  Clock,
  Sprout,
  LayoutList,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import type { PlanningSession, PlanningSessionStatus } from "../../domain/types";

interface SessionHistoryCardProps {
  session: PlanningSession;
  formattedDate: string;
  formattedDuration: string;
  onClick: () => void;
  onDelete: () => void;
}

const statusConfig: Record<
  PlanningSessionStatus,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  active: { label: "Active", variant: "default" },
  completed: { label: "Completed", variant: "secondary" },
  archived: { label: "Archived", variant: "outline" },
  interrupted: { label: "Interrupted", variant: "outline" },
};

const getInitials = (name: string | null): string => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

export const SessionHistoryCard: React.FC<SessionHistoryCardProps> = ({
  session,
  formattedDate,
  formattedDuration,
  onClick,
  onDelete,
}) => {
  const statusInfo = statusConfig[session.status];
  const creatorName = session.createdByUserName?.trim() || "Unknown";

  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex w-full items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      aria-label={`View session: ${session.title}`}
    >
      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Title row */}
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-medium">{session.title}</h3>
          <Badge variant={statusInfo.variant} className="shrink-0">
            {statusInfo.label}
          </Badge>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Avatar className="size-5 shrink-0">
            {session.createdByUserImage && (
              <AvatarImage
                src={session.createdByUserImage}
                alt={creatorName}
              />
            )}
            <AvatarFallback className="text-[10px]">
              {getInitials(creatorName)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{creatorName}</span>
        </div>

        {/* Meta row: project + date */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {session.projectName && (
            <span className="truncate">{session.projectName}</span>
          )}
          <span>{formattedDate}</span>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1" title="Seeds">
            <Sprout className="size-3.5" />
            {session.seedCount}
          </span>

          <span className="inline-flex items-center gap-1" title="Work items">
            <LayoutList className="size-3.5" />
            {session.workItemCount}
          </span>

          {formattedDuration && (
            <span className="inline-flex items-center gap-1" title="Duration">
              <Clock className="size-3.5" />
              {formattedDuration}
            </span>
          )}
        </div>
      </div>

      {/* Delete button */}
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 touch-visible"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`Delete session: ${session.title}`}
      >
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </div>
  );
};
