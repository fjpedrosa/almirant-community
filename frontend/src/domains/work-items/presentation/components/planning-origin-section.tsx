import Link from "next/link";
import { ExternalLink, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getProviderIcon,
  getProviderLabel,
} from "@/domains/shared/presentation/utils/provider-icons";
import type { PlanningOriginProps } from "../../domain/types";

// --- Pure helpers ---

const formatModelName = (model: string | undefined): string => {
  if (!model) return "Unknown model";
  // Shorten long model names for display (e.g., "claude-sonnet-4-20250514" -> "claude-sonnet-4")
  const parts = model.split("-");
  // If the last part looks like a date (8 digits), remove it
  if (parts.length > 1 && /^\d{8}$/.test(parts[parts.length - 1])) {
    return parts.slice(0, -1).join("-");
  }
  return model;
};

// --- Component ---

export const PlanningOriginSection: React.FC<PlanningOriginProps> = ({
  planningSessionId,
  planningModel,
  planningProvider,
  fromSeedIds,
  sessionTitle,
  sessionUrl,
  isLoadingSession,
}) => {
  if (!planningSessionId) {
    return (
      <p className="text-xs text-muted-foreground">No planning origin data.</p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Planning Session Card */}
      <div className="flex items-start gap-2.5 rounded-lg bg-muted/50 p-3">
        <div className="flex size-6 items-center justify-center rounded-full bg-primary/10 shrink-0">
          <Sparkles className="size-3.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          {isLoadingSession ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            <div className="flex items-center gap-1.5">
              {sessionUrl ? (
                <Link
                  href={sessionUrl}
                  className="text-xs font-medium hover:underline truncate"
                >
                  {sessionTitle ?? "Planning Session"}
                </Link>
              ) : (
                <span className="text-xs font-medium truncate">
                  {sessionTitle ?? "Planning Session"}
                </span>
              )}
              {sessionUrl && (
                <ExternalLink className="size-3 text-muted-foreground shrink-0" />
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Created via AI planning
          </p>
        </div>
      </div>

      {/* Model & Provider */}
      {(planningModel || planningProvider) && (
        <div className="flex flex-wrap items-center gap-2">
          {planningProvider && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {getProviderIcon(planningProvider)}
              <span>{getProviderLabel(planningProvider)}</span>
            </div>
          )}
          {planningModel && (
            <Badge variant="outline" className="text-[10px] font-mono">
              {formatModelName(planningModel)}
            </Badge>
          )}
        </div>
      )}

      {/* Seeds */}
      {fromSeedIds && fromSeedIds.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-2.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Contributing Seeds
          </p>
          <div className="flex flex-wrap gap-1.5">
            {fromSeedIds.map((seedId) => (
              <Badge
                key={seedId}
                variant="secondary"
                className="text-[10px] font-mono"
              >
                {seedId.slice(0, 8)}...
              </Badge>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {fromSeedIds.length} seed{fromSeedIds.length !== 1 ? "s" : ""} contributed to this item
          </p>
        </div>
      )}
    </div>
  );
};
