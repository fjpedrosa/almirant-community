import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Zap,
  CheckCircle2,
  ArrowRightLeft,
  Clock,
  Bot,
  Image as ImageIcon,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  ExternalLink,
  FileText,
  Share2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  SprintReportProps,
  SprintReportData,
  SprintComparison,
  SprintWorkItemDetail,
} from "../../domain/types";
import type { WorkItemType, Priority } from "@/domains/work-items/domain/types";
import { ChangelogContent } from "./changelog-content";
import { UserContributionStats } from "./user-contribution-stats";

// --- Color maps (reuse from sprint-item-row patterns) ---

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-400",
};

const priorityBarColors: Record<string, string> = {
  urgent: "bg-red-500/80",
  high: "bg-orange-500/80",
  medium: "bg-yellow-500/80",
  low: "bg-blue-400/80",
};

const priorityLabelKeys: Record<string, string> = {
  urgent: "urgent",
  high: "high",
  medium: "medium",
  low: "low",
};

const typeBadgeColors: Record<string, string> = {
  epic: "border-purple-500/50 text-purple-600 bg-purple-500/10",
  feature: "border-blue-500/50 text-blue-600 bg-blue-500/10",
  story: "border-green-500/50 text-green-600 bg-green-500/10",
  task: "border-zinc-500/50 text-zinc-600 bg-zinc-500/10",
};

const typeBarColors: Record<string, string> = {
  epic: "bg-purple-500/80",
  feature: "bg-blue-500/80",
  story: "bg-green-500/80",
  task: "bg-zinc-500/80",
};

const typeLabelKeys: Record<string, string> = {
  epic: "epic",
  feature: "feature",
  story: "story",
  task: "task",
};

// --- Helper functions ---

const formatDate = (date: string | null): string => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatShortDate = (date: string | null): string => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
};

const formatHours = (hours: number): string => {
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  return `${hours.toFixed(1)}h`;
};

const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
};

const formatCurrency = (amount: number): string => {
  return `$${amount.toFixed(2)}`;
};

const getInitials = (name: string | null): string => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

// --- Sub-components ---

const LoadingSkeleton: React.FC = () => (
  <div className="space-y-6 p-6">
    <div className="space-y-2">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-40" />
    </div>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
    <Skeleton className="h-64 w-full" />
  </div>
);

const MetricCard: React.FC<{
  title: string;
  value: string;
  icon: React.ReactNode;
  trend?: { direction: "up" | "down" | "neutral"; label: string };
  subtitle?: string;
}> = ({ title, value, icon, trend, subtitle }) => (
  <Card className="py-4">
    <CardContent className="px-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="rounded-md bg-muted p-2 text-muted-foreground">
          {icon}
        </div>
      </div>
      {trend && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          {trend.direction === "up" && (
            <TrendingUp className="h-3 w-3 text-green-500" />
          )}
          {trend.direction === "down" && (
            <TrendingDown className="h-3 w-3 text-red-500" />
          )}
          {trend.direction === "neutral" && (
            <Minus className="h-3 w-3 text-muted-foreground" />
          )}
          <span
            className={cn(
              "font-medium",
              trend.direction === "up" && "text-green-600 dark:text-green-400",
              trend.direction === "down" && "text-red-600 dark:text-red-400",
              trend.direction === "neutral" && "text-muted-foreground"
            )}
          >
            {trend.label}
          </span>
        </div>
      )}
    </CardContent>
  </Card>
);

const HorizontalBar: React.FC<{
  label: string;
  count: number;
  total: number;
  barClassName: string;
}> = ({ label, count, total, barClassName }) => {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {count} ({Math.round(percentage)}%)
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barClassName)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

const DistributionByType: React.FC<{
  distribution: Record<string, number>;
}> = ({ distribution }) => {
  const t = useTranslations("sprints.report");
  const tTypes = useTranslations("workItemTypes");
  const total = Object.values(distribution).reduce((s, v) => s + v, 0);
  const types: WorkItemType[] = ["epic", "feature", "story", "task"];

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-sm">{t("distributionByType")}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-2 space-y-3">
        {types.map((type) => {
          const count = distribution[type] ?? 0;
          if (count === 0) return null;
          return (
            <HorizontalBar
              key={type}
              label={tTypes(typeLabelKeys[type])}
              count={count}
              total={total}
              barClassName={typeBarColors[type]}
            />
          );
        })}
        {total === 0 && (
          <p className="text-xs text-muted-foreground">{t("noData")}</p>
        )}
      </CardContent>
    </Card>
  );
};

const DistributionByPriority: React.FC<{
  distribution: Record<string, number>;
}> = ({ distribution }) => {
  const t = useTranslations("sprints.report");
  const tPriorities = useTranslations("priorities");
  const total = Object.values(distribution).reduce((s, v) => s + v, 0);
  const priorities: Priority[] = ["urgent", "high", "medium", "low"];

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-sm">{t("distributionByPriority")}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-2 space-y-3">
        {priorities.map((priority) => {
          const count = distribution[priority] ?? 0;
          if (count === 0) return null;
          return (
            <HorizontalBar
              key={priority}
              label={tPriorities(priorityLabelKeys[priority])}
              count={count}
              total={total}
              barClassName={priorityBarColors[priority]}
            />
          );
        })}
        {total === 0 && (
          <p className="text-xs text-muted-foreground">{t("noData")}</p>
        )}
      </CardContent>
    </Card>
  );
};

const DistributionByAssignee: React.FC<{
  distribution: { assignee: string | null; count: number }[];
}> = ({ distribution }) => {
  const t = useTranslations("sprints.report");
  if (distribution.length === 0) {
    return (
      <Card className="py-4">
        <CardHeader className="px-4 pb-0">
          <CardTitle className="text-sm">{t("distributionByAssignee")}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pt-2">
          <p className="text-xs text-muted-foreground">{t("noData")}</p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(...distribution.map((d) => d.count));

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="text-sm">{t("distributionByAssignee")}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-2 space-y-2">
        {distribution.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {getInitials(entry.assignee)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate font-medium">
                  {entry.assignee ?? t("unassigned")}
                </span>
                <span className="text-muted-foreground shrink-0 ml-2">
                  {entry.count}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/60 transition-all"
                  style={{
                    width: `${maxCount > 0 ? (entry.count / maxCount) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

const TasksTable: React.FC<{
  items: SprintWorkItemDetail[];
  showCompletedDate: boolean;
  emptyMessage: string;
}> = ({ items, showCompletedDate, emptyMessage }) => {
  const t = useTranslations("sprints.report");
  const tPriorities = useTranslations("priorities");
  const tTypes = useTranslations("workItemTypes");
  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("tableTitle")}</TableHead>
          <TableHead className="w-[80px]">{t("tableType")}</TableHead>
          <TableHead className="w-[90px]">{t("tablePriority")}</TableHead>
          <TableHead className="w-[120px]">{t("tableAssignee")}</TableHead>
          {showCompletedDate && (
            <TableHead className="w-[100px]">{t("tableCompleted")}</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="max-w-[300px] truncate font-medium">
              {item.title}
            </TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={cn("text-[10px]", typeBadgeColors[item.type])}
              >
                {tTypes(typeLabelKeys[item.type])}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "h-2 w-2 rounded-full",
                    priorityColors[item.priority]
                  )}
                />
                <span className="text-xs">
                  {tPriorities(priorityLabelKeys[item.priority])}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <span className="text-xs text-muted-foreground truncate max-w-[100px] block">
                {item.assignee ?? t("unassigned")}
              </span>
            </TableCell>
            {showCompletedDate && (
              <TableCell>
                <span className="text-xs text-muted-foreground">
                  {formatShortDate(item.completedAt)}
                </span>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const AiCostSection: React.FC<{
  aiCost: SprintReportData["aiCost"];
}> = ({ aiCost }) => {
  const t = useTranslations("sprints.report");
  return (
  <Card className="py-4">
    <CardHeader className="px-4 pb-0">
      <CardTitle className="flex items-center gap-2 text-sm">
        <Bot className="h-4 w-4" />
        {t("aiCost")}
      </CardTitle>
    </CardHeader>
    <CardContent className="px-4 pt-2">
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">{t("sessions")}</p>
          <p className="text-lg font-semibold">{aiCost.totalSessions}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">{t("tokens")}</p>
          <p className="text-lg font-semibold">
            {formatTokens(aiCost.totalTokens)}
          </p>
        </div>
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">{t("estimatedCost")}</p>
          <p className="text-lg font-semibold">
            {formatCurrency(aiCost.totalCost)}
          </p>
        </div>
      </div>
    </CardContent>
  </Card>
  );
};

const VelocityTrend: React.FC<{
  comparison: SprintComparison[];
  currentVelocity: number;
  currentSprintName: string;
}> = ({ comparison, currentVelocity, currentSprintName }) => {
  const t = useTranslations("sprints.report");
  if (comparison.length === 0) {
    return null;
  }

  const allEntries = [
    ...comparison.map((c) => ({
      name: c.sprintName,
      velocity: c.velocity,
      isCurrent: false,
    })),
    { name: currentSprintName, velocity: currentVelocity, isCurrent: true },
  ];

  const maxVelocity = Math.max(...allEntries.map((e) => e.velocity), 1);

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4" />
          {t("velocityTrend")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-4">
        <TooltipProvider>
          <div className="flex items-end gap-1.5" style={{ height: "120px" }}>
            {allEntries.map((entry, idx) => {
              const barHeight = (entry.velocity / maxVelocity) * 100;
              return (
                <Tooltip key={idx}>
                  <TooltipTrigger asChild>
                    <div className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {entry.velocity.toFixed(1)}
                      </span>
                      <div
                        className={cn(
                          "w-full rounded-t transition-all",
                          entry.isCurrent
                            ? "bg-primary"
                            : "bg-primary/30"
                        )}
                        style={{
                          height: `${Math.max(barHeight, 4)}%`,
                        }}
                      />
                      <span className="max-w-full truncate text-[10px] text-muted-foreground">
                        {entry.name.length > 8
                          ? `${entry.name.slice(0, 7)}...`
                          : entry.name}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs font-medium">{entry.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("velocityLabel", { value: entry.velocity.toFixed(2) })}
                    </p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
};

const ScreenshotsSection: React.FC<{
  screenshots: SprintReportData["screenshots"];
}> = ({ screenshots }) => {
  const t = useTranslations("sprints.report");
  if (!screenshots || screenshots.total === 0) return null;

  return (
    <Card className="py-4">
      <CardHeader className="px-4 pb-0">
        <CardTitle className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            {t("screenshots", { count: screenshots.total })}
          </span>
          {screenshots.document && (
            <Link
              href={`/docs?docId=${screenshots.document.id}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("viewVisualReport")}
            </Link>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pt-4 space-y-5">
        {screenshots.groups.map((group) => {
          const groupLabel = `${group.groupTaskId ?? ""} ${group.groupTitle}`.trim();
          return (
            <div key={group.groupId} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold truncate">
                  {groupLabel || t("unknownGroup")}
                </p>
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {group.screenshots.length}
                </Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {group.screenshots.map((s, idx) => (
                  <div
                    key={`${group.groupId}-${idx}-${s.imageUrl}`}
                    className="space-y-2"
                  >
                    <div className="overflow-hidden rounded-md border bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.imageUrl}
                        alt={s.caption}
                        loading="lazy"
                        className="w-full h-auto"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {s.caption}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

// --- Main component ---

export const SprintReport: React.FC<SprintReportProps> = ({
  report,
  isLoading,
  onClose,
  fullReportHref,
  onShareToX,
  canShareToX,
}) => {
  const t = useTranslations("sprints.report");
  const tSprints = useTranslations("sprints");
  if (isLoading) {
    return (
      <Dialog open onOpenChange={() => onClose()}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden p-0">
          <LoadingSkeleton />
        </DialogContent>
      </Dialog>
    );
  }

  const { sprint } = report;
  const isClosed = sprint.status === "closed";
  const totalTasks = report.completedTasks.count + report.carryoverTasks.count;

  // Calculate velocity trend from comparison data
  const previousSprint =
    report.comparison.length > 0
      ? report.comparison[report.comparison.length - 1]
      : null;

  const velocityTrend = previousSprint
    ? {
        direction: (report.velocity > previousSprint.velocity
          ? "up"
          : report.velocity < previousSprint.velocity
            ? "down"
            : "neutral") as "up" | "down" | "neutral",
        label:
          report.velocity > previousSprint.velocity
            ? `+${(report.velocity - previousSprint.velocity).toFixed(1)} ${t("vsFormer")}`
            : report.velocity < previousSprint.velocity
              ? `${(report.velocity - previousSprint.velocity).toFixed(1)} ${t("vsFormer")}`
              : t("sameAsPrevious"),
      }
    : undefined;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden p-0">
        <ScrollArea className="max-h-[90vh]">
          <div className="space-y-6 p-6">
            {/* Header */}
            <DialogHeader>
              <div className="flex items-center gap-3">
                <DialogTitle className="text-xl">{sprint.name}</DialogTitle>
                <Badge
                  variant={isClosed ? "secondary" : "default"}
                  className="text-xs"
                >
                  {isClosed ? tSprints("closed") : tSprints("open")}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(sprint.startDate)} - {formatDate(sprint.endDate ?? sprint.closedAt)}
                </span>
                <span>{totalTasks} {t("totalItems")}</span>
                {onShareToX && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={onShareToX}
                    disabled={!canShareToX}
                  >
                    <Share2 className="h-3.5 w-3.5 mr-1" />
                    {t("shareToX")}
                  </Button>
                )}
                {fullReportHref && (
                  <Link
                    href={fullReportHref}
                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("viewFullReport")}
                  </Link>
                )}
              </div>
            </DialogHeader>

            <Separator />

            {/* Top-level tabs: Summary vs Changelog */}
            <Tabs defaultValue={report.changelog ? "changelog" : "summary"}>
              <TabsList>
                <TabsTrigger value="summary">
                  {t("summaryTab")}
                </TabsTrigger>
                {report.changelog && (
                  <TabsTrigger value="changelog">
                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                    {t("changelogTab")}
                  </TabsTrigger>
                )}
              </TabsList>

              {/* Changelog tab */}
              {report.changelog && (
                <TabsContent value="changelog" className="mt-4">
                  <ChangelogContent markdown={report.changelog} />
                </TabsContent>
              )}

              {/* Summary tab */}
              <TabsContent value="summary" className="mt-4 space-y-6">
                {/* Key metrics */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MetricCard
                    title={t("velocity")}
                    value={`${report.velocity.toFixed(1)}`}
                    subtitle={t("tasksPerDay")}
                    icon={<Zap className="h-4 w-4" />}
                    trend={velocityTrend}
                  />
                  <MetricCard
                    title={t("completed")}
                    value={report.completedTasks.count.toString()}
                    subtitle={
                      totalTasks > 0
                        ? t("ofTotal", { percentage: Math.round((report.completedTasks.count / totalTasks) * 100) })
                        : undefined
                    }
                    icon={<CheckCircle2 className="h-4 w-4" />}
                  />
                  <MetricCard
                    title={t("pending")}
                    value={report.carryoverTasks.count.toString()}
                    subtitle={t("carryover")}
                    icon={<ArrowRightLeft className="h-4 w-4" />}
                  />
                  <MetricCard
                    title={t("avgTime")}
                    value={formatHours(report.averageTimePerTask)}
                    subtitle={t("perTask")}
                    icon={<Clock className="h-4 w-4" />}
                  />
                </div>

                {/* Distributions */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DistributionByType distribution={report.distributionByType} />
                  <DistributionByPriority
                    distribution={report.distributionByPriority}
                  />
                </div>

                {/* Assignee distribution */}
                <DistributionByAssignee
                  distribution={report.distributionByAssignee}
                />

                <UserContributionStats userStats={report.userStats} />

                {/* Task tables */}
                <Tabs defaultValue="completed">
                  <TabsList>
                    <TabsTrigger value="completed">
                      {t("completedTab", { count: report.completedTasks.count })}
                    </TabsTrigger>
                    <TabsTrigger value="carryover">
                      {t("pendingTab", { count: report.carryoverTasks.count })}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="completed" className="mt-3">
                    <Card className="py-2">
                      <CardContent className="px-2">
                        <TasksTable
                          items={report.completedTasks.items}
                          showCompletedDate
                          emptyMessage={t("noCompletedTasks")}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="carryover" className="mt-3">
                    <Card className="py-2">
                      <CardContent className="px-2">
                        <TasksTable
                          items={report.carryoverTasks.items}
                          showCompletedDate={false}
                          emptyMessage={t("noPendingTasks")}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>

                {/* Screenshots (visual evidence) */}
                <ScreenshotsSection screenshots={report.screenshots} />

                {/* AI Cost */}
                <AiCostSection aiCost={report.aiCost} />

                {/* Velocity Trend */}
                <VelocityTrend
                  comparison={report.comparison}
                  currentVelocity={report.velocity}
                  currentSprintName={sprint.name}
                />
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
