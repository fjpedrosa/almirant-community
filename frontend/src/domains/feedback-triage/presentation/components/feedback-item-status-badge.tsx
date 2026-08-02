import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Inbox,
  ClipboardCheck,
  Search,
  Hourglass,
  Wrench,
  Rocket,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { FeedbackItemStatus } from "../../domain/types";

export interface FeedbackItemStatusBadgeProps {
  status: FeedbackItemStatus;
  className?: string;
}

const statusConfig: Record<
  FeedbackItemStatus,
  {
    label: string;
    className: string;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
  }
> = {
  new: {
    label: "New",
    className:
      "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-900/30 dark:text-slate-400 dark:border-slate-800",
    icon: Inbox,
    title: "New feedback item awaiting triage",
  },
  triaged: {
    label: "Triaged",
    className:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
    icon: ClipboardCheck,
    title: "Feedback has been reviewed and categorized",
  },
  in_progress: {
    label: "In Progress",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
    icon: Search,
    title: "Investigation or analysis in progress",
  },
  pending_validation: {
    label: "Pending Validation",
    className:
      "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
    icon: Hourglass,
    title: "Awaiting validation before implementation",
  },
  implementing: {
    label: "Implementing",
    className:
      "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800",
    icon: Wrench,
    title: "Fix or feature is being implemented",
  },
  deployed: {
    label: "Deployed",
    className:
      "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-400 dark:border-cyan-800",
    icon: Rocket,
    title: "Changes have been deployed to production",
  },
  verified: {
    label: "Verified",
    className:
      "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
    icon: ShieldCheck,
    title: "Fix has been verified and confirmed working",
  },
  cancelled: {
    label: "Cancelled",
    className:
      "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-800",
    icon: XCircle,
    title: "Feedback item has been cancelled",
  },
};

export const FeedbackItemStatusBadge: React.FC<FeedbackItemStatusBadgeProps> = ({
  status,
  className,
}) => {
  const config = statusConfig[status] ?? {
    label: status,
    className: "",
    icon: Inbox,
    title: `Status: ${status}`,
  };
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn("h-5 px-2 font-medium", config.className, className)}
      title={config.title}
      aria-label={config.title}
    >
      <Icon className="mr-1 h-3 w-3" aria-hidden="true" />
      {config.label}
    </Badge>
  );
};
