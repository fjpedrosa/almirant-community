"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GitPullRequest } from "lucide-react";
import type { GithubPrListProps } from "../../domain/types";
import { GithubPrItem } from "./github-pr-item";

export const GithubPrList: React.FC<GithubPrListProps> = ({
  pullRequests,
  isLoading,
}) => {
  const t = useTranslations("github");
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitPullRequest className="h-4 w-4" aria-hidden="true" />
            {t("pullRequests")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
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
          <GitPullRequest className="h-4 w-4" aria-hidden="true" />
          {t("pullRequests")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pullRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t("noPrs")}
          </p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto pr-1" role="table" aria-label="Pull requests">
            {pullRequests.map((pr) => (
              <GithubPrItem
                key={pr.id}
                title={pr.title}
                number={pr.number}
                authorLogin={pr.authorLogin}
                authorAvatarUrl={pr.authorAvatarUrl}
                labels={pr.labels}
                reviewStatus={pr.reviewStatus}
                ciStatus={pr.ciStatus}
                isDraft={pr.isDraft}
                createdAt={pr.createdAt}
                htmlUrl={pr.htmlUrl}
                additions={pr.additions}
                deletions={pr.deletions}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
