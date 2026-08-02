import { ExternalLink, GitPullRequest } from "lucide-react";
import { BugFixAttemptStatusBadge } from "@/domains/shared/presentation/components/bug-fix-attempt-status-badge";
import { parseSolutionProposed } from "../../domain/proposed-solution";
import { ProposedSolutionRenderer } from "./proposed-solution-renderer";
import type { BugFixAttemptSummary } from "../../domain/types";

export interface BugFixAttemptTimelineItemProps {
  attempt: BugFixAttemptSummary;
}

const SolutionProposedBlock: React.FC<{ raw: string }> = ({ raw }) => {
  const parsed = parseSolutionProposed(raw);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">
        Proposed Solution
      </p>
      {parsed ? (
        <ProposedSolutionRenderer solution={parsed} />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{raw}</p>
      )}
    </div>
  );
};

/**
 * Single timeline item representing a bug fix attempt.
 * Shows attempt number, status, root cause, solution, and PR link if available.
 *
 * Usage:
 * <BugFixAttemptTimelineItem attempt={attempt} />
 */
export const BugFixAttemptTimelineItem: React.FC<BugFixAttemptTimelineItemProps> = ({
  attempt,
}) => {
  return (
    <div className="relative border-l-2 border-border pb-6 pl-4 last:pb-0">
      {/* Timeline dot */}
      <div className="absolute -left-[5px] top-0 h-2 w-2 rounded-full bg-border" />

      <div className="space-y-2">
        {/* Header: Attempt number + status */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">
            Attempt #{attempt.attemptNumber}
          </span>
          <BugFixAttemptStatusBadge status={attempt.status} />
        </div>

        {/* Date */}
        <p className="text-xs text-muted-foreground">
          {new Date(attempt.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>

        {/* Root cause */}
        {attempt.rootCause && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Root Cause</p>
            <p className="text-sm">{attempt.rootCause}</p>
          </div>
        )}

        {/* Proposed solution */}
        {attempt.solutionProposed && (
          <SolutionProposedBlock raw={attempt.solutionProposed} />
        )}

        {/* PR Link - only render if available */}
        {attempt.fixPrUrl && (
          <a
            href={attempt.fixPrUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            {attempt.fixPrNumber ? `PR #${attempt.fixPrNumber}` : "View PR"}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}

        {/* PR status info if PR exists */}
        {attempt.pr && (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {attempt.pr.state && (
              <span className="capitalize">State: {attempt.pr.state}</span>
            )}
            {attempt.pr.reviewStatus && (
              <span className="capitalize">
                Review: {attempt.pr.reviewStatus.replace("_", " ")}
              </span>
            )}
            {attempt.pr.ciStatus && (
              <span className="capitalize">
                CI: {attempt.pr.ciStatus.replace("_", " ")}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
