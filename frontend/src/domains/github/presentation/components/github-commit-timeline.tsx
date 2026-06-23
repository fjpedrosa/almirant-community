"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GitCommit } from "lucide-react";
import type { GithubCommitTimelineProps } from "../../domain/types";
import { GithubCommitItem } from "./github-commit-item";

export const GithubCommitTimeline: React.FC<GithubCommitTimelineProps> = ({
  commits,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitCommit className="h-4 w-4" aria-hidden="true" />
            Commits
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 flex-1" />
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
          <GitCommit className="h-4 w-4" aria-hidden="true" />
          Commits
        </CardTitle>
      </CardHeader>
      <CardContent>
        {commits.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No commits yet
          </p>
        ) : (
          <div className="relative max-h-[360px] overflow-y-auto pr-1" role="list" aria-label="Commit timeline">
            {/* Vertical timeline line */}
            <div
              className="absolute left-[11px] top-4 bottom-4 w-px bg-border"
              aria-hidden="true"
            />

            <div className="space-y-0.5 relative">
              {commits.map((commit) => (
                <GithubCommitItem
                  key={commit.id}
                  sha={commit.sha}
                  message={commit.message}
                  authorLogin={commit.authorLogin}
                  authorAvatarUrl={commit.authorAvatarUrl}
                  branch={commit.branch}
                  committedAt={commit.committedAt}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
