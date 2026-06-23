import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface BoundaryBadgeProps {
  boundary?: string | null;
  runtime?: string | null;
}

type BoundaryKey =
  | "runner"
  | "web-bridge"
  | "frontend"
  | "backend-api"
  | "database"
  | "stream-consumer"
  | "unknown";

const boundaryColors: Record<BoundaryKey, string> = {
  runner: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  "web-bridge":
    "border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400",
  frontend:
    "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400",
  "backend-api":
    "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  database:
    "border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-400",
  "stream-consumer":
    "border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  unknown: "border-gray-500/40 bg-gray-500/10 text-gray-600 dark:text-gray-400",
};

const getBoundaryClass = (boundary: string): string => {
  const normalizedBoundary = boundary.toLowerCase() as BoundaryKey;
  return boundaryColors[normalizedBoundary] ?? boundaryColors.unknown;
};

export const BoundaryBadge: React.FC<BoundaryBadgeProps> = ({
  boundary,
  runtime,
}) => {
  const hasBoundary = boundary != null && boundary !== "";
  const hasRuntime = runtime != null && runtime !== "";

  if (!hasBoundary && !hasRuntime) {
    return null;
  }

  return (
    <div className="inline-flex items-center gap-1.5" data-testid="boundary-badge-group">
      {hasBoundary && (
        <Badge
          variant="outline"
          className={cn("text-xs", getBoundaryClass(boundary))}
          data-testid="boundary-badge"
        >
          {boundary}
        </Badge>
      )}
      {hasRuntime && (
        <Badge
          variant="outline"
          className="text-xs border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
          data-testid="runtime-badge"
        >
          {runtime}
        </Badge>
      )}
    </div>
  );
};
