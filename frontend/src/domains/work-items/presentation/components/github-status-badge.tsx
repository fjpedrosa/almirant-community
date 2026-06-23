import { AlertTriangle, CircleCheck, GitMerge, GitPullRequest, GitPullRequestDraft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PullRequestRef, CiStatusRef } from "../../domain/types";

interface GitHubStatusBadgeProps {
  pullRequest?: PullRequestRef;
  ciStatus?: CiStatusRef;
  size?: "sm" | "md";
}

function getPrIcon(pr: PullRequestRef, iconClass: string) {
  if (pr.state === "merged") return <GitMerge className={iconClass} />;
  if (pr.isDraft && pr.state === "open") return <GitPullRequestDraft className={iconClass} />;
  return <GitPullRequest className={iconClass} />;
}

function getPrColorClass(pr: PullRequestRef, withHover: boolean) {
  if (pr.state === "merged") return withHover ? "text-purple-500 hover:text-purple-600" : "text-purple-500";
  if (pr.isDraft && pr.state === "open") return withHover ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground";
  if (pr.state === "closed") return withHover ? "text-red-500 hover:text-red-600" : "text-red-500";
  return withHover ? "text-green-500 hover:text-green-600" : "text-green-500";
}

function getPrLabel(pr: PullRequestRef) {
  const stateLabel = pr.isDraft && pr.state === "open" ? "draft" : pr.state;
  return `PR #${pr.number} (${stateLabel})`;
}

function isCiSuccess(ciStatus: CiStatusRef) {
  return ciStatus.status === "completed" && ciStatus.conclusion === "success"
    || ciStatus.status === "success";
}

function isCiFailure(ciStatus: CiStatusRef) {
  return ciStatus.status === "completed" && (ciStatus.conclusion === "failure" || ciStatus.conclusion === "timed_out" || ciStatus.conclusion === "cancelled")
    || ciStatus.status === "failure";
}

export function GitHubStatusBadge({ pullRequest, ciStatus, size = "sm" }: GitHubStatusBadgeProps) {
  if (!pullRequest && !ciStatus) return null;

  const iconClass = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";
  const withHover = size === "md";

  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      {pullRequest && (
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={pullRequest.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn("transition-colors", getPrColorClass(pullRequest, withHover))}
            >
              {getPrIcon(pullRequest, iconClass)}
            </a>
          </TooltipTrigger>
          <TooltipContent>{getPrLabel(pullRequest)}</TooltipContent>
        </Tooltip>
      )}
      {ciStatus && isCiSuccess(ciStatus) && (
        <Tooltip>
          <TooltipTrigger asChild>
            {ciStatus.url ? (
              <a
                href={ciStatus.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="text-green-500 hover:text-green-600 transition-colors"
              >
                <CircleCheck className={iconClass} />
              </a>
            ) : (
              <span className="text-green-500">
                <CircleCheck className={iconClass} />
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent>
            {ciStatus.workflowName ? `CI: ${ciStatus.workflowName} passed` : "CI passed"}
          </TooltipContent>
        </Tooltip>
      )}
      {ciStatus && isCiFailure(ciStatus) && (
        <Tooltip>
          <TooltipTrigger asChild>
            {ciStatus.url ? (
              <a
                href={ciStatus.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="text-orange-500 hover:text-orange-600 transition-colors"
              >
                <AlertTriangle className={iconClass} />
              </a>
            ) : (
              <span className="text-orange-500">
                <AlertTriangle className={iconClass} />
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent>
            {ciStatus.workflowName
              ? `CI: ${ciStatus.workflowName} — ${ciStatus.conclusion ?? "failed"}`
              : `CI ${ciStatus.conclusion ?? "failed"}`}
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
