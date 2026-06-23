import { formatDistanceToNow } from "date-fns";
import { User, Radio, Server, Clock } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getProviderIcon,
  getProviderLabel,
} from "@/domains/shared/presentation/utils/provider-icons";
import type {
  ProvenanceLastOrigin,
  ProvenanceActiveRun,
  ProvenanceSessionSummary,
} from "../../domain/types";

// --- Pure helpers ---

const describeOrigin = (
  source: string | null,
  processType: string | null,
  triggeredBy: string
): string => {
  if (source === "manual" || triggeredBy === "user") {
    return "Manual from web";
  }
  if (triggeredBy === "worker" || triggeredBy === "system") {
    const label = processType ?? "process";
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} via worker`;
  }
  if (triggeredBy === "claude-code") {
    return "Claude Code session";
  }
  if (triggeredBy === "mcp") {
    return "MCP tool call";
  }
  if (triggeredBy === "api") {
    return "API request";
  }
  if (triggeredBy === "nightly") {
    return "Nightly job";
  }
  return triggeredBy || "Unknown";
};

const getRunStatusColor = (status: string): string => {
  switch (status) {
    case "running":
      return "bg-green-500";
    case "finalizing":
      return "bg-sky-500";
    case "queued":
      return "bg-yellow-500";
    case "waiting_for_input":
      return "bg-blue-500";
    case "paused":
      return "bg-orange-500";
    default:
      return "bg-muted-foreground";
  }
};

const getRunStatusVariant = (
  status: string
): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "running":
      return "default";
    case "finalizing":
      return "secondary";
    case "queued":
    case "paused":
      return "secondary";
    default:
      return "outline";
  }
};

const formatRelative = (dateStr: string | null): string => {
  if (!dateStr) return "-";
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return "-";
  }
};

const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
};

const getUserInitials = (name: string | null): string => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

// --- Component ---

interface ExecutionOriginCardProps {
  lastOrigin: ProvenanceLastOrigin | null;
  activeRun: ProvenanceActiveRun | null;
  sessionSummary: ProvenanceSessionSummary | null;
  isLoading: boolean;
}

export const ExecutionOriginCard: React.FC<ExecutionOriginCardProps> = ({
  lastOrigin,
  activeRun,
  sessionSummary,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }

  if (!lastOrigin && !activeRun) {
    return (
      <p className="text-xs text-muted-foreground">No execution origin data.</p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Last Origin */}
      {lastOrigin && (
        <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 p-3">
          {lastOrigin.userImage || lastOrigin.userName ? (
            <Avatar className="size-6">
              <AvatarImage
                src={lastOrigin.userImage ?? undefined}
                alt={lastOrigin.userName ?? "User"}
              />
              <AvatarFallback className="text-[10px]">
                {getUserInitials(lastOrigin.userName)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <div className="flex size-6 items-center justify-center rounded-full bg-muted">
              <User className="size-3 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">
              {describeOrigin(
                lastOrigin.source,
                lastOrigin.processType,
                lastOrigin.triggeredBy
              )}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {lastOrigin.userName ?? lastOrigin.triggeredBy}
              {" \u00b7 "}
              {formatRelative(lastOrigin.timestamp)}
            </p>
          </div>
          {lastOrigin.skillName && (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {lastOrigin.skillName}
            </Badge>
          )}
        </div>
      )}

      {/* Active Run */}
      {activeRun && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block size-2 rounded-full ${getRunStatusColor(activeRun.status)} animate-pulse`}
              />
              <span className="text-xs font-medium capitalize">
                {activeRun.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {getProviderIcon(activeRun.provider, "h-3.5 w-3.5")}
                <span className="text-[10px]">
                  {getProviderLabel(activeRun.provider)}
                </span>
              </div>
              {activeRun.skillName && (
                <Badge
                  variant={getRunStatusVariant(activeRun.status)}
                  className="text-[10px]"
                >
                  {activeRun.skillName}
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {activeRun.startedAt && (
              <div className="flex items-center gap-1">
                <Clock className="size-3" />
                <span>Started {formatRelative(activeRun.startedAt)}</span>
              </div>
            )}
            {activeRun.createdByUserName && (
              <div className="flex items-center gap-1">
                <User className="size-3" />
                <span className="truncate">{activeRun.createdByUserName}</span>
              </div>
            )}
          </div>

          {activeRun.worker && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground border-t pt-2">
              <div className="flex items-center gap-1">
                <Server className="size-3" />
                <span className="font-mono">{activeRun.worker.hostname}</span>
              </div>
              {activeRun.worker.lastHeartbeatAt && (
                <div className="flex items-center gap-1">
                  <Radio className="size-3" />
                  <span>
                    heartbeat {formatRelative(activeRun.worker.lastHeartbeatAt)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Session Summary */}
      {sessionSummary && sessionSummary.totalSessions > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {sessionSummary.totalSessions} session
          {sessionSummary.totalSessions !== 1 ? "s" : ""}
          {" \u00b7 "}
          {formatTokens(sessionSummary.totalTokens)} tokens
          {" \u00b7 "}${sessionSummary.totalEstimatedCost}
        </p>
      )}
    </div>
  );
};
