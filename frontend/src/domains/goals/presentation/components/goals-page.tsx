"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { GoalLaunchTodoItem, GoalsMeetingPageProps } from "../../domain/types";
import { RadialProgress } from "./radial-progress";

const formatDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const statusClass: Record<GoalLaunchTodoItem["status"], string> = {
  planned: "bg-muted text-muted-foreground",
  in_progress: "bg-status-warning/15 text-status-warning",
  blocked: "bg-status-error/15 text-status-error",
  completed: "bg-status-success/15 text-status-success",
};

const riskClass: Record<GoalLaunchTodoItem["risk"], string> = {
  low: "text-status-success",
  medium: "text-status-warning",
  high: "text-status-error",
};

const healthTone: Record<string, string> = {
  "En ritmo": "bg-status-success/15 text-status-success",
  Atencion: "bg-status-warning/15 text-status-warning",
  "Riesgo alto": "bg-status-error/15 text-status-error",
};

const deltaClass = (delta: number): string => {
  if (delta >= 0) return "text-status-success";
  if (delta >= -10) return "text-status-warning";
  return "text-status-error";
};

const statusIcon = (status: GoalLaunchTodoItem["status"]) => {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" />;
  if (status === "blocked") return <AlertTriangle className="h-4 w-4 shrink-0 text-status-error" />;
  return <Clock3 className="h-4 w-4 shrink-0 text-status-warning" />;
};

const TodoRow: React.FC<{ item: GoalLaunchTodoItem; t: ReturnType<typeof useTranslations<"goals">> }> = ({ item, t }) => {
  const getStatusLabel = (status: GoalLaunchTodoItem["status"]): string => {
    return t(`todo.status.${status}`);
  };

  return (
    <div className="flex items-center gap-3 border-b border-border/50 py-2.5 last:border-b-0">
      {statusIcon(item.status)}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {item.block}
          </Badge>
          <Badge className={cn("text-[10px] px-1.5 py-0", statusClass[item.status])}>
            {getStatusLabel(item.status)}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">{item.description}</p>
      </div>
      <div className="w-20 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 flex-1 rounded-full bg-primary/15">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${item.progress}%` }}
            />
          </div>
          <span className="text-[10px] font-semibold tabular-nums w-7 text-right">
            {item.progress}%
          </span>
        </div>
      </div>
      <span className={cn("text-[10px] shrink-0 font-medium capitalize w-12 text-right", riskClass[item.risk])}>
        {item.risk}
      </span>
    </div>
  );
};

export const GoalsPage: React.FC<GoalsMeetingPageProps> = ({
  goalTitle,
  goalDescription,
  startDate,
  targetDate,
  lastUpdated,
  successCriteria,
  measurementNotes,
  readinessAreas,
  requiredItems,
  optionalItems,
  readinessByBlock,
  launchProgress,
  expectedProgress,
  progressDelta,
  daysRemaining,
  blockedItems,
  highRiskItems,
  projectedFinishDate,
  healthLabel,
}) => {
  const t = useTranslations("goals");

  return (
    <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top,_oklch(0.55_0.25_295/0.06),_transparent_55%)] p-4 md:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        {/* Header card */}
        <Card className="border-primary/20 bg-card py-3">
          <CardHeader className="gap-2 px-4 md:px-5 pb-0">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-2xl">{goalTitle}</CardTitle>
                <CardDescription>{goalDescription}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{t("meeting.start")} {formatDate(startDate)}</Badge>
                <Badge variant="outline">{t("meeting.deadline")} {formatDate(targetDate)}</Badge>
                <Badge variant="outline">{t("meeting.updated")} {formatDate(lastUpdated)}</Badge>
                <Badge className={healthTone[healthLabel] ?? "bg-muted text-muted-foreground"}>
                  {healthLabel}
                </Badge>
              </div>
            </div>

            <div className="grid gap-2 rounded-xl border border-primary/15 bg-primary/5 p-3 md:grid-cols-2">
              {successCriteria.map((criterion) => (
                <div key={criterion} className="flex items-start gap-2 text-sm text-foreground/80">
                  <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{criterion}</span>
                </div>
              ))}
            </div>
          </CardHeader>
        </Card>

        {/* Metrics row */}
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Card className="py-3">
            <CardContent className="flex flex-col items-center gap-1 px-4">
              <RadialProgress value={launchProgress} size={72} strokeWidth={7} />
              <CardDescription className="text-xs">{t("meeting.launchProgress")}</CardDescription>
            </CardContent>
          </Card>

          <Card className="py-3">
            <CardContent className="flex flex-col items-center gap-1 px-4">
              <RadialProgress value={expectedProgress} size={72} strokeWidth={7} />
              <CardDescription className="text-xs">{t("meeting.expectedToday")}</CardDescription>
            </CardContent>
          </Card>

          <Card className="py-3">
            <CardHeader className="gap-1 px-4 pb-0">
              <CardDescription>{t("meeting.delta")}</CardDescription>
              <CardTitle className={cn("text-2xl", deltaClass(progressDelta))}>
                {progressDelta > 0 ? "+" : ""}
                {progressDelta}%
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="py-3">
            <CardHeader className="gap-1 px-4 pb-0">
              <CardDescription>{t("meeting.daysRemaining")}</CardDescription>
              <CardTitle className={cn("text-2xl", daysRemaining <= 7 ? "text-status-error" : "")}>
                {daysRemaining}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="py-3">
            <CardHeader className="gap-1 px-4 pb-0">
              <CardDescription>{t("meeting.blockersHighRisk")}</CardDescription>
              <CardTitle className="text-2xl">
                {blockedItems} / {highRiskItems}
              </CardTitle>
            </CardHeader>
          </Card>
        </section>

        {/* Ritmo vs plan + Readiness por bloque */}
        <section className="grid gap-3 xl:grid-cols-2">
          <Card className="py-3">
            <CardHeader className="gap-1 px-4 pb-0">
              <CardTitle className="text-lg">{t("meeting.paceVsPlan")}</CardTitle>
              <CardDescription>{t("meeting.paceVsPlanDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              {/* Overlay bar */}
              <div className="relative h-3 w-full rounded-full bg-muted/40">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/20"
                  style={{ width: `${expectedProgress}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
                  style={{ width: `${launchProgress}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-muted-foreground/60"
                  style={{ left: `${expectedProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                  {t("meeting.real")} <span className="font-semibold text-foreground">{launchProgress}%</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/20" />
                  {t("meeting.expected")} <span className="font-semibold text-foreground">{expectedProgress}%</span>
                </span>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2.5 text-sm">
                <p className="font-medium">
                  {t("meeting.projectedDate")}{" "}
                  <span className="text-foreground">
                    {projectedFinishDate ? formatDate(projectedFinishDate) : t("meeting.noProjection")}
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="py-3">
            <CardHeader className="gap-1 px-4 pb-0">
              <CardTitle className="text-lg">{t("meeting.readinessByBlock")}</CardTitle>
              <CardDescription>{t("meeting.readinessByBlockDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 px-4">
              {readinessByBlock.map((block) => (
                <div key={block.block} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {block.label} ({block.totalWeight}% {t("meeting.weight")})
                    </span>
                    <span className="font-semibold text-foreground">{block.progress}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-primary/15">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${block.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* Todo lists */}
        <section className="grid gap-3 xl:grid-cols-2">
          <Card className="py-3">
            <CardHeader className="gap-1 px-4 pb-0">
              <CardTitle className="text-lg">{t("meeting.launchTodo")}</CardTitle>
              <CardDescription>{t("meeting.launchTodoDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              {requiredItems.map((item) => (
                <TodoRow key={item.id} item={item} t={t} />
              ))}
            </CardContent>
          </Card>

          <Card className="py-3">
            <CardHeader className="gap-1 px-4 pb-0">
              <CardTitle className="text-lg">{t("meeting.backlogPostLaunch")}</CardTitle>
              <CardDescription>{t("meeting.backlogPostLaunchDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              {optionalItems.map((item) => (
                <TodoRow key={item.id} item={item} t={t} />
              ))}
            </CardContent>
          </Card>
        </section>

        {/* Readiness areas + Measurement notes */}
        <section className="grid gap-3 xl:grid-cols-2">
          <Card className="py-3">
            <CardHeader className="gap-1 px-4 pb-0">
              <CardTitle className="text-lg">{t("meeting.productReadiness")}</CardTitle>
              <CardDescription>
                {t("meeting.productReadinessDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <div className="grid grid-cols-2 gap-4">
                {readinessAreas.map((area) => (
                  <div key={area.id} className="flex flex-col items-center gap-1 text-center">
                    <RadialProgress value={area.progress} size={64} strokeWidth={6} />
                    <span className="text-xs font-medium leading-tight">{area.title}</span>
                    <p className="text-[10px] text-muted-foreground leading-tight">{area.note}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="py-3">
            <CardHeader className="gap-1 px-4 pb-0">
              <CardTitle className="text-lg">{t("meeting.measurementNotes")}</CardTitle>
              <CardDescription>{t("meeting.measurementNotesDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 px-4">
              {measurementNotes.map((note) => (
                <div key={note} className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2.5 text-sm">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{note}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
};
