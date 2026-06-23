"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Play } from "lucide-react";
import type { GithubActionsListProps } from "../../domain/types";
import { GithubActionItem } from "./github-action-item";

export const GithubActionsList: React.FC<GithubActionsListProps> = ({
  workflowRuns,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Play className="h-4 w-4" aria-hidden="true" />
            Workflow Runs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Play className="h-4 w-4" aria-hidden="true" />
          Workflow Runs
        </CardTitle>
      </CardHeader>
      <CardContent>
        {workflowRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No workflow runs
          </p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto pr-1" role="list" aria-label="Workflow runs">
            {workflowRuns.map((run) => (
              <GithubActionItem
                key={run.id}
                name={run.name}
                status={run.status}
                conclusion={run.conclusion}
                branch={run.branch}
                htmlUrl={run.htmlUrl}
                startedAt={run.startedAt}
                completedAt={run.completedAt}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
