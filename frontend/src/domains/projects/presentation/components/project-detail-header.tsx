"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Pencil, ExternalLink, Archive } from "lucide-react";
import type { ProjectDetailHeaderProps } from "../../domain/types";

export const ProjectDetailHeader: React.FC<ProjectDetailHeaderProps> = ({
  name,
  color,
  description,
  status,
  githubRepoUrl,
  onBack,
  onEdit,
}) => {
  const tCommon = useTranslations("common");
  const t = useTranslations("projects");

  return (
    <>
      {status === "archived" && (
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          <Archive className="h-4 w-4" />
          <AlertTitle>{t("archivedBanner.title")}</AlertTitle>
          <AlertDescription>{t("archivedBanner.description")}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={onBack} aria-label="Go back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="mt-2 h-4 w-4 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight sm:text-3xl">{name}</h1>
            {githubRepoUrl && (
              <a
                href={githubRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 shrink-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Open repository on GitHub"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={onEdit}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
            {tCommon("edit")}
          </Button>
        </div>
      </div>

      {description && (
        <p className="break-words text-sm text-muted-foreground sm:text-base">{description}</p>
      )}
    </>
  );
};
