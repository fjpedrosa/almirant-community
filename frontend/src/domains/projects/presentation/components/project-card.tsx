"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Github, Globe, ListChecks } from "lucide-react";
import { statusLabels, statusColors } from "../../application/hooks/use-projects-page";
import { GithubSummaryBadges } from "@/domains/github/presentation/components/github-summary-badges";
import type { ProjectCardProps } from "../../domain/types";

export const ProjectCard: React.FC<ProjectCardProps> = ({
  name,
  description,
  coverImageUrl,
  color,
  status,
  workItemsCount,
  completedItemsCount,
  clientName,
  techStack,
  github,
  organizationName,
  epicCount = 0,
  featureCount = 0,
  storyCount = 0,
  taskCount,
  completedTaskCount,
}) => {
  const t = useTranslations("projects");
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);

  // Use per-type counts when available, fall back to legacy totals
  const displayTaskCount = taskCount ?? workItemsCount;
  const displayCompletedTaskCount = completedTaskCount ?? completedItemsCount;
  const progress = displayTaskCount > 0
    ? Math.round((displayCompletedTaskCount / displayTaskCount) * 100)
    : 0;

  // Build breakdown segments for non-task types (only show types with count > 0)
  const breakdownSegments: string[] = [];
  if (epicCount > 0) breakdownSegments.push(`${epicCount} ${t("card.epics")}`);
  if (featureCount > 0) breakdownSegments.push(`${featureCount} ${t("card.features")}`);
  if (storyCount > 0) breakdownSegments.push(`${storyCount} ${t("card.stories")}`);
  const showCoverImage = Boolean(coverImageUrl && coverImageUrl !== failedCoverUrl);

  return (
    <Card className="flex h-full min-h-[360px] flex-col gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md">
      <div
        className="relative h-32 shrink-0 overflow-hidden border-b bg-muted"
        style={{
          background: `linear-gradient(135deg, ${color}1A, ${color}40)`,
        }}
      >
        {showCoverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImageUrl ?? ""}
            alt={`Captura de la landing page de ${name}`}
            width={640}
            height={320}
            className="h-full w-full object-cover object-top"
            loading="lazy"
            onError={() => setFailedCoverUrl(coverImageUrl)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Globe className="h-10 w-10" style={{ color }} aria-hidden="true" />
          </div>
        )}
      </div>

      <CardHeader className="pt-6 pb-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex items-center gap-2">
            <div
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <CardTitle className="text-base line-clamp-1">{name}</CardTitle>
            {github && (
              <Github className="h-3.5 w-3.5 text-muted-foreground" aria-label="GitHub connected" />
            )}
          </div>
          <Badge variant="secondary" className={`${statusColors[status]} shrink-0`}>
            {statusLabels[status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-3 pb-6">
        <div className="flex min-h-6 flex-wrap items-center gap-1.5">
          {organizationName ? (
            <Badge variant="outline" className="text-xs">
              {organizationName}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Personal
            </Badge>
          )}
          {clientName && (
            <Badge variant="outline" className="text-xs">
              {clientName}
            </Badge>
          )}
        </div>
        <p className="min-h-10 text-sm text-muted-foreground line-clamp-2">
          {description || ""}
        </p>
        <div className="min-h-6">
          {techStack && techStack.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {techStack.slice(0, 3).map((tech) => (
                <span key={tech} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                  {tech}
                </span>
              ))}
              {techStack.length > 3 && (
                <span className="text-xs text-muted-foreground">
                  +{techStack.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
        <p className="min-h-4 text-xs text-muted-foreground">
          {breakdownSegments.join(" \u00B7 ")}
        </p>
        <div className="mt-auto flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ListChecks className="h-3 w-3" aria-hidden="true" />
            {displayCompletedTaskCount}/{displayTaskCount} {t("card.tasks")}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted">
          {displayTaskCount > 0 && (
            <div
              className="h-1.5 rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          )}
        </div>
        <div className="min-h-6">
          {github && (
            <GithubSummaryBadges
              openPrCount={github.openPrCount}
              lastCommitAt={github.lastCommitAt}
              lastDeployStatus={github.lastDeployStatus}
              githubRepoUrl={github.githubRepoUrl}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
};
