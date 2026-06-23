import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentJobStatus } from "../../domain/types";
import { resolveRunStatusLabel } from "../../domain/run-utils";

const getVariant = (
  status: AgentJobStatus
): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "running":
      return "default";
    case "finalizing":
      return "secondary";
    case "queued":
    case "waiting_for_input":
    case "paused":
      return "secondary";
    case "failed":
      return "destructive";
    case "cancelled":
      return "outline";
    case "incomplete":
      return "outline";
    case "completed":
      return "outline";
    default:
      return "secondary";
  }
};

const getClassName = (status: AgentJobStatus): string => {
  switch (status) {
    case "running":
      return "animate-pulse";
    case "finalizing":
      return "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "cancelled":
      return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "incomplete":
      return "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300";
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "paused":
      return "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300";
    default:
      return "";
  }
};

interface AgentJobStatusBadgeProps {
  status: AgentJobStatus;
  errorType?: string | null;
  errorMessage?: string | null;
}

export const AgentJobStatusBadge: React.FC<AgentJobStatusBadgeProps> = ({
  status,
  errorType,
  errorMessage,
}) => {
  return (
    <Badge
      variant={getVariant(status)}
      className={cn(getClassName(status))}
    >
      {resolveRunStatusLabel(status, { errorType, errorMessage })}
    </Badge>
  );
};
