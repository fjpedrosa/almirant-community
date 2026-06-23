import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type BugFixAttemptStatus =
  | "analyzing"
  | "proposed"
  | "implementing"
  | "merged"
  | "failed";

export interface BugFixAttemptStatusBadgeProps {
  status: BugFixAttemptStatus;
}

const statusConfig: Record<
  string,
  { label: string; className: string }
> = {
  analyzing: {
    label: "Analyzing",
    className: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  },
  proposed: {
    label: "Proposed",
    className: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
  },
  implementing: {
    label: "Implementing",
    className: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
  },
  merged: {
    label: "Merged",
    className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  },
};

export const BugFixAttemptStatusBadge: React.FC<BugFixAttemptStatusBadgeProps> = ({
  status,
}) => {
  const config = statusConfig[status] ?? {
    label: status,
    className: "",
  };

  return (
    <Badge
      variant="outline"
      className={cn("font-medium", config.className)}
    >
      {config.label}
    </Badge>
  );
};
