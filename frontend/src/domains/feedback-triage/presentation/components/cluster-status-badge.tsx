import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Inbox,
  Search,
  GitPullRequest,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Archive,
} from "lucide-react";
import type { ClusterStatus } from "../../domain/types";

export type ClusterStatusBadgeSize = "sm" | "md" | "lg";

export interface ClusterStatusBadgeProps {
  status: ClusterStatus;
  /**
   * Visual size escalation for the badge. Defaults to "sm" (the original
   * compact form used in lists / inline metadata). Use "lg" inside the
   * cluster detail hero header where the badge needs to read as primary
   * information, not metadata.
   */
  size?: ClusterStatusBadgeSize;
}

const statusConfig: Record<
  ClusterStatus,
  {
    label: string;
    className: string;
    icon: React.ComponentType<{ className?: string }>;
    title?: string;
  }
> = {
  open: {
    label: "Open",
    className:
      "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-900/30 dark:text-slate-400 dark:border-slate-800",
    icon: Inbox,
  },
  investigating: {
    label: "Investigating",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
    icon: Search,
  },
  fix_ready: {
    label: "Fix Ready",
    className:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
    icon: GitPullRequest,
  },
  resolved: {
    label: "Resolved",
    className:
      "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
    icon: CheckCircle,
  },
  regression: {
    label: "Regression",
    className:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
    icon: AlertTriangle,
  },
  dismissed: {
    label: "Dismissed",
    className:
      "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-800",
    icon: XCircle,
  },
  promoted: {
    label: "Promoted",
    className:
      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800",
    icon: Archive,
    title: "Legacy status - clusters are now promoted via work item creation",
  },
};

const sizeConfig: Record<
  ClusterStatusBadgeSize,
  { badge: string; icon: string }
> = {
  sm: { badge: "h-5 px-2 text-xs font-medium", icon: "mr-1 h-3 w-3" },
  md: { badge: "h-6 px-2.5 text-sm font-medium", icon: "mr-1.5 h-3.5 w-3.5" },
  lg: { badge: "h-7 px-3 text-sm font-semibold", icon: "mr-1.5 h-4 w-4" },
};

export const ClusterStatusBadge: React.FC<ClusterStatusBadgeProps> = ({
  status,
  size = "sm",
}) => {
  const config = statusConfig[status] ?? {
    label: status,
    className: "",
    icon: Inbox,
  };
  const Icon = config.icon;
  const sizing = sizeConfig[size];

  return (
    <Badge
      variant="outline"
      className={cn(sizing.badge, config.className)}
      title={config.title}
    >
      <Icon className={sizing.icon} />
      {config.label}
    </Badge>
  );
};
