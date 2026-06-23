import { History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SessionHistoryCard } from "./session-history-card";
import type { PlanningSession } from "../../domain/types";

interface SessionHistoryListProps {
  sessions: PlanningSession[];
  isLoading: boolean;
  formatDate: (date: string) => string;
  formatDuration: (ms: number | null) => string;
  onSessionClick: (id: string) => void;
  onDelete: (id: string) => void;
}

export const SessionHistoryList: React.FC<SessionHistoryListProps> = ({
  sessions,
  isLoading,
  formatDate,
  formatDuration,
  onSessionClick,
  onDelete,
}) => {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <History className="size-6 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-medium">No sessions found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Planning sessions will appear here once created.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sessions.map((session) => (
        <SessionHistoryCard
          key={session.id}
          session={session}
          formattedDate={formatDate(session.createdAt)}
          formattedDuration={formatDuration(session.durationMs)}
          onClick={() => onSessionClick(session.id)}
          onDelete={() => onDelete(session.id)}
        />
      ))}
    </div>
  );
};
