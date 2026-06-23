"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, ExternalLink, Github, RefreshCw } from "lucide-react";
import type { ProjectScreenshotCardProps } from "../../domain/types";

export const ProjectScreenshotCard: React.FC<ProjectScreenshotCardProps> = ({
  name,
  color,
  productionUrl,
  status,
  screenshotUrl,
  hostname,
  imageError,
  hasUrl,
  githubRepoUrl,
  githubRepoName,
  onImageError,
  onVisitSite,
  onRefreshScreenshot,
  isRefreshing,
}) => {
  const t = useTranslations("projects");

  const statusLabel: Record<string, string> = {
    active: t("status.active"),
    on_hold: t("status.onHold"),
    archived: t("status.archived"),
  };

  const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
    active: "default",
    on_hold: "secondary",
    archived: "outline",
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex flex-col gap-4 md:flex-row">
          {/* Screenshot section */}
          <div className="w-full flex-shrink-0 overflow-hidden rounded-lg border bg-muted md:w-[360px]">
            {/* Browser chrome bar */}
            <div className="flex items-center gap-2 px-3 py-2 bg-muted border-b">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
              </div>
              <div className="flex-1 bg-background/60 rounded-md px-3 py-0.5 text-xs text-muted-foreground truncate">
                {hostname || t("screenshot.noUrlConfigured")}
              </div>
            </div>

            {/* Screenshot / Fallback */}
            {hasUrl && screenshotUrl && !imageError ? (
              <div className="relative w-full h-[200px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshotUrl}
                  alt={`Preview de ${name}`}
                  width={720}
                  height={400}
                  className="h-full w-full object-cover object-top"
                  onError={onImageError}
                />
              </div>
            ) : (
              <div
                className="w-full h-[200px] flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${color}20, ${color}40)`,
                }}
              >
                <Globe
                  className="h-12 w-12"
                  style={{ color }}
                  aria-hidden="true"
                />
              </div>
            )}
          </div>

          {/* Info section */}
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 p-2 sm:p-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <h3 className="min-w-0 break-words text-base font-semibold sm:text-lg">{name}</h3>
                <Badge variant={statusVariant[status] || "secondary"}>
                  {statusLabel[status] || status}
                </Badge>
              </div>

              {hostname && (
                <a
                  href={productionUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 truncate text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {hostname}
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
              )}

              {!hasUrl && (
                <p className="text-sm text-muted-foreground">
                  {t("screenshot.noProductionUrl")}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
              {githubRepoUrl && (
                <a
                  href={githubRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto"
                >
                  <Button variant="outline" size="sm" className="w-full sm:w-auto">
                    <Github className="mr-2 h-4 w-4" aria-hidden="true" />
                    {githubRepoName || t("reposTab.repository")}
                  </Button>
                </a>
              )}
              {hasUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={onVisitSite}
                >
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("screenshot.visit")}
                </Button>
              )}
              {hasUrl && onRefreshScreenshot && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={onRefreshScreenshot}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
                  {isRefreshing ? t("screenshot.capturing") : t("screenshot.refreshScreenshot")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
