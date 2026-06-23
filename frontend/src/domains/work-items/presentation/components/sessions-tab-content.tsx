import Link from "next/link";
import { TerminalSquare, Clock, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentJobStatusBadge } from "@/domains/agents/presentation/components/agent-job-status-badge";
import {
  resolveSkillLabel,
  formatDuration,
  getDurationMs,
} from "@/domains/sessions/domain/utils";
import type { AgentSessionListItem } from "@/domains/sessions/domain/types";

interface SessionsTabContentProps {
  sessions: AgentSessionListItem[];
  isLoading: boolean;
  currentTime: number;
}

const LoadingSkeleton = () => (
  <div className="space-y-3">
    {[1, 2, 3].map((i) => (
      <div key={i} className="rounded-lg border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    ))}
  </div>
);

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const SessionsTabContent: React.FC<SessionsTabContentProps> = ({
  sessions,
  isLoading,
  currentTime,
}) => {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-muted-foreground text-sm min-h-[200px]">
        <TerminalSquare className="h-8 w-8 mb-2 opacity-50" />
        <p>No sessions found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <Link
          key={session.id}
          href={`/sessions/${session.id}`}
          className="block rounded-lg border bg-card p-3 hover:bg-accent/50 transition-colors group"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium truncate">
              {resolveSkillLabel(session)}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <AgentJobStatusBadge status={session.status} />
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground touch-visible" />
            </div>
          </div>

          <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(getDurationMs(session, currentTime))}
            </span>
            <span>
              {formatDate(session.startedAt ?? session.createdAt)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
};
