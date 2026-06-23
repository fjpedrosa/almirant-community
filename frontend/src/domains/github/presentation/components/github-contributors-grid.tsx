"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Users } from "lucide-react";
import type { GithubContributorsGridProps } from "../../domain/types";

export const GithubContributorsGrid: React.FC<GithubContributorsGridProps> = ({
  contributors,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4" aria-hidden="true" />
            Contributors
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4" aria-hidden="true" />
          Contributors
        </CardTitle>
      </CardHeader>
      <CardContent>
        {contributors.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No contributors
          </p>
        ) : (
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-4"
            role="list"
            aria-label="Contributors"
          >
            {contributors.map((contributor) => {
              const initial = contributor.login.charAt(0).toUpperCase();
              const displayName = contributor.name ?? contributor.login;

              return (
                <div
                  key={contributor.login}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-md hover:bg-muted/50 transition-colors"
                  role="listitem"
                >
                  <Avatar className="h-10 w-10">
                    {contributor.avatarUrl && (
                      <AvatarImage
                        src={contributor.avatarUrl}
                        alt={displayName}
                      />
                    )}
                    <AvatarFallback className="text-xs">{initial}</AvatarFallback>
                  </Avatar>

                  <span className="text-xs font-medium text-center truncate w-full">
                    {displayName}
                  </span>

                  <span className="text-[10px] text-muted-foreground">
                    {contributor.commitCount}{" "}
                    {contributor.commitCount === 1 ? "commit" : "commits"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
