import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Calendar, CheckCircle2, BarChart3 } from "lucide-react";
import type { ProjectSprintsTabProps, ProjectSprintItem } from "../../domain/types";

const formatDate = (dateStr: string | null): string | null => {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const SprintCard: React.FC<{
  sprint: ProjectSprintItem;
  onViewReport?: () => void;
  completedLabel: string;
  itemsLabel: string;
  boardLabel: string;
  openLabel: string;
  closedLabel: string;
  viewReportLabel: string;
}> = ({ sprint, onViewReport, completedLabel, itemsLabel, boardLabel, openLabel, closedLabel, viewReportLabel }) => {
  const isOpen = sprint.status === "open";
  const isClosed = sprint.status === "closed";
  const dateDisplay = sprint.closedAt
    ? formatDate(sprint.closedAt)
    : sprint.startDate && sprint.endDate
      ? `${formatDate(sprint.startDate)} - ${formatDate(sprint.endDate)}`
      : sprint.startDate
        ? formatDate(sprint.startDate)
        : null;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 shrink-0" />
            <span className="truncate">{sprint.name}</span>
          </CardTitle>
          <Badge variant={isOpen ? "default" : "secondary"} className="text-xs shrink-0">
            {isOpen ? openLabel : closedLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {sprint.workItemCount} {itemsLabel}
          </span>
          {dateDisplay && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {isClosed ? completedLabel : ""} {dateDisplay}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {boardLabel}: {sprint.boardName}
        </div>
        {isClosed && onViewReport && (
          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={onViewReport}
            >
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              {viewReportLabel}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const ProjectSprintsTab: React.FC<ProjectSprintsTabProps> = ({
  sprints,
  isLoading,
  onSprintClick,
}) => {
  const t = useTranslations("projects.sprintsTab");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("title")}</h3>
      </div>
      {sprints.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sprints.map((sprint) => (
            <SprintCard
              key={sprint.id}
              sprint={sprint}
              onViewReport={
                onSprintClick && sprint.status === "closed"
                  ? () => onSprintClick(sprint.id)
                  : undefined
              }
              completedLabel={t("completed")}
              itemsLabel={t("items")}
              boardLabel={t("board")}
              openLabel={t("open")}
              closedLabel={t("closed")}
              viewReportLabel={t("viewReport")}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Package className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">{t("noSprints")}</p>
        </div>
      )}
    </div>
  );
};
