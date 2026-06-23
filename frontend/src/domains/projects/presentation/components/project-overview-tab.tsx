"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Folder, Calendar } from "lucide-react";
import { statusLabels, statusColors } from "../../application/hooks/use-projects-page";
import type { ProjectOverviewTabProps } from "../../domain/types";

const formatDate = (date: Date | null): string => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("es-ES", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export const ProjectOverviewTab: React.FC<ProjectOverviewTabProps> = ({
  description,
  clientName,
  productionUrl,
  stagingUrl,
  techStack,
  folderPath,
  startDate,
  targetDate,
  status,
}) => {
  const t = useTranslations("projects");

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* General Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{t("overview.generalInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {description && (
            <div>
              <span className="text-muted-foreground">{t("overview.description")}</span>
              <p className="mt-1">{description}</p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("overview.client")}</span>
            <span>{clientName || t("form.internal")}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("overview.status")}</span>
            <Badge variant="secondary" className={statusColors[status]}>
              {statusLabels[status]}
            </Badge>
          </div>
          {folderPath && (
            <div className="flex items-center gap-2">
              <Folder className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground text-xs font-mono truncate">
                {folderPath}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{t("overview.dates")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {t("overview.start")}
            </span>
            <span>{formatDate(startDate)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {t("overview.target")}
            </span>
            <span>{formatDate(targetDate)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Environments */}
      {(productionUrl || stagingUrl) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">{t("overview.environments")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {productionUrl && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("overview.production")}</span>
                <a
                  href={productionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline truncate max-w-[200px]"
                >
                  {new URL(productionUrl).hostname}
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              </div>
            )}
            {stagingUrl && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("overview.staging")}</span>
                <a
                  href={stagingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline truncate max-w-[200px]"
                >
                  {new URL(stagingUrl).hostname}
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tech Stack */}
      {techStack && techStack.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Tech Stack</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {techStack.map((tech) => (
                <Badge key={tech} variant="outline" className="text-xs">
                  {tech}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
