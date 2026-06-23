"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  BarChart3,
  Ban,
  CheckCircle2,
  Clock3,
  Container,
  Cpu,
  FolderKanban,
  Gauge,
  MemoryStick,
  Server,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { useAnalyticsPage } from "../../application/hooks/use-analytics-page";
import type {
  AnalyticsSystemMonitoringResponse,
  AnalyticsWorker,
  AnalyticsWorkerJob,
} from "../../domain/types";

const formatMinutes = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  return new Intl.NumberFormat().format(minutes);
};

const formatNumber = (value: number): string =>
  new Intl.NumberFormat().format(value);

const formatPercent = (value: number | null | undefined): string =>
  value == null
    ? "—"
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;

const formatMb = (value: number | null | undefined): string => {
  if (value == null) return "—";
  if (value >= 1024) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1024)} GB`;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)} MB`;
};

const periodLabel = (period: string): string => {
  const [year, month] = period.split("-");
  if (!year || !month) return period;
  return `${month}/${year.slice(-2)}`;
};

const toNumber = (value: string | number | null | undefined): number => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
};

interface KpiCardProps {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  isLoading: boolean;
}

const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  subtitle,
  icon: Icon,
  isLoading,
}) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">
        {label}
      </CardTitle>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </CardHeader>
    <CardContent>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-24" />
          {subtitle && <Skeleton className="h-3 w-20" />}
        </div>
      ) : (
        <div>
          <div className="text-2xl font-bold">{value}</div>
          {subtitle && (
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      )}
    </CardContent>
  </Card>
);

interface SystemMonitoringPanelProps {
  data: AnalyticsSystemMonitoringResponse | undefined;
  isLoading: boolean;
  hasError: boolean;
  t: (key: string) => string;
  onCancelJob: (jobId: string) => void;
  isCancellingJob: boolean;
}

type ProcessRow = {
  id: string;
  jobId: string;
  worker: string;
  title: string;
  subtitle: string;
  kind: string;
  createdAt: string | null;
  cpuPercent: number | null;
  memoryMb: number | null;
  memoryLimitMb: number | null;
  forecastMemoryMb: number | null;
  canCancel: boolean;
};

const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "finalizing", "waiting_for_input", "paused"]);
const CPU_CAPACITY_TARGET_PERCENT = 70;

const looksLikeContainerHash = (value: string): boolean =>
  /^[a-f0-9]{12,64}$/i.test(value);

const formatWorkerDisplayName = (worker: AnalyticsWorker, index: number): string => {
  if (!looksLikeContainerHash(worker.hostname)) return worker.hostname;
  return `Runner ${index + 1}`;
};

const formatShortId = (value: string | null | undefined, length = 12): string => {
  if (!value) return "—";
  return value.length > length ? value.slice(0, length) : value;
};


const getJobForecastMemoryMb = (job: AnalyticsWorkerJob | undefined): number | null => {
  const estimate = job?.config?.resourceEstimate;
  if (!estimate || typeof estimate !== "object") return null;

  const memoryMb = (estimate as Record<string, unknown>).estimatedMemoryMb;
  return typeof memoryMb === "number" && Number.isFinite(memoryMb)
    ? memoryMb
    : null;
};

const resolveJobTitle = (job: AnalyticsWorkerJob | undefined, fallbackId: string): string => {
  if (job?.workItemTaskId && job.workItemTitle) {
    return `${job.workItemTaskId} · ${job.workItemTitle}`;
  }
  if (job?.workItemTitle) return job.workItemTitle;
  if (job?.workItemTaskId) return job.workItemTaskId;
  return `Job ${formatShortId(fallbackId)}`;
};

const resolveJobKind = (
  job: AnalyticsWorkerJob | undefined,
  fallback: string | null | undefined,
): string =>
  job?.promptTemplate ??
  job?.skillName ??
  (typeof job?.config?.skillName === "string" ? job.config.skillName : null) ??
  fallback ??
  job?.jobType ??
  "unknown";

const buildProcessRows = (workers: AnalyticsWorker[]): ProcessRow[] =>
  workers.flatMap((worker, workerIndex): ProcessRow[] => {
    const metrics = worker.systemMetrics;
    const workerName = formatWorkerDisplayName(worker, workerIndex);
    const containerMetricsByJobId = new Map(
      (metrics?.containerMetrics ?? []).map((containerMetric) => [
        containerMetric.jobId,
        containerMetric,
      ]),
    );
    const processesByJobId = new Map(
      (metrics?.processes ?? []).map((process) => [process.jobId, process]),
    );

    return worker.activeJobDetails.map((job): ProcessRow => {
      const containerMetric = containerMetricsByJobId.get(job.id);
      if (containerMetric) {
        return {
          id: `${worker.workerId}-${containerMetric.containerId}`,
          jobId: job.id,
          worker: workerName,
          title: resolveJobTitle(job, job.id),
          subtitle: `Container ${formatShortId(containerMetric.containerId)} · ${formatShortId(job.id)}`,
          kind: resolveJobKind(job, containerMetric.jobType),
          createdAt: job.createdAt ?? containerMetric.createdAt ?? null,
          cpuPercent: containerMetric.cpuPercent,
          memoryMb: containerMetric.memoryUsageMb,
          memoryLimitMb: containerMetric.memoryLimitMb,
          forecastMemoryMb: getJobForecastMemoryMb(job),
          canCancel: ACTIVE_JOB_STATUSES.has(job.status),
        };
      }

      const process = processesByJobId.get(job.id);
      if (process) {
        return {
          id: `${worker.workerId}-${job.id}`,
          jobId: job.id,
          worker: workerName,
          title: resolveJobTitle(job, job.id),
          subtitle: `Process ${formatShortId(job.id)}`,
          kind: resolveJobKind(job, process.skillName),
          createdAt: job.createdAt ?? null,
          cpuPercent: null,
          memoryMb: null,
          memoryLimitMb: null,
          forecastMemoryMb: getJobForecastMemoryMb(job),
          canCancel: ACTIVE_JOB_STATUSES.has(job.status),
        };
      }

      return {
        id: `${worker.workerId}-${job.id}`,
        jobId: job.id,
        worker: workerName,
        title: resolveJobTitle(job, job.id),
        subtitle: `Job ${formatShortId(job.id)}`,
        kind: resolveJobKind(job, job.jobType),
        createdAt: job.createdAt,
        cpuPercent: null,
        memoryMb: null,
        memoryLimitMb: null,
        forecastMemoryMb: getJobForecastMemoryMb(job),
        canCancel: ACTIVE_JOB_STATUSES.has(job.status),
      };
    });
  });

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};


const MemoryStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border bg-muted/20 px-3 py-2">
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className="mt-0.5 font-mono text-xs tabular-nums text-foreground">
      {value}
    </p>
  </div>
);

const SystemMonitoringPanel: React.FC<SystemMonitoringPanelProps> = ({
  data,
  isLoading,
  hasError,
  t,
  onCancelJob,
  isCancellingJob,
}) => {
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  const handleCancelJob = async (jobId: string) => {
    const confirmed = await confirm({
      title: t("system.cancelJobTitle"),
      description: t("system.cancelJobDescription"),
      confirmLabel: t("system.cancelJob"),
      variant: "destructive",
    });

    if (confirmed) {
      onCancelJob(jobId);
    }
  };
  const workers = data?.workers ?? [];
  const onlineWorkers = workers.filter((worker) => worker.status === "online");
  const metricWorkers = onlineWorkers.filter((worker) => worker.systemMetrics);
  const processRows = buildProcessRows(onlineWorkers);
  const latestByWorker = new Map(
    (data?.metricsHistory ?? []).map((snapshot) => [
      snapshot.workerId,
      snapshot,
    ]),
  );

  const avgCpu =
    metricWorkers.length > 0
      ? metricWorkers.reduce(
          (sum, worker) => sum + (worker.systemMetrics?.cpuPercent ?? 0),
          0,
        ) / metricWorkers.length
      : null;
  const ramUsedMb = metricWorkers.reduce(
    (sum, worker) => sum + (worker.systemMetrics?.ramUsedMb ?? 0),
    0,
  );
  const ramTotalMb = metricWorkers.reduce(
    (sum, worker) => sum + (worker.systemMetrics?.ramTotalMb ?? 0),
    0,
  );
  const activeJobs = onlineWorkers.reduce(
    (sum, worker) => sum + worker.activeJobs,
    0,
  );
  const totalCapacity = onlineWorkers.reduce(
    (sum, worker) => sum + worker.maxConcurrentAgents,
    0,
  );
  const availableSlots = onlineWorkers.reduce(
    (sum, worker) => sum + worker.availableSlots,
    0,
  );
  const measuredCpuRows = processRows.filter(
    (process) => process.cpuPercent != null,
  );
  const totalJobCpu = measuredCpuRows.reduce(
    (sum, process) => sum + (process.cpuPercent ?? 0),
    0,
  );
  const cpuPerActiveJob =
    measuredCpuRows.length > 0 ? totalJobCpu / measuredCpuRows.length : null;
  const cpuHeadroom =
    avgCpu == null
      ? null
      : Math.max(0, CPU_CAPACITY_TARGET_PERCENT - avgCpu);
  const cpuOnlyExtraSlots =
    cpuHeadroom != null && cpuPerActiveJob != null && cpuPerActiveJob > 0
      ? Math.floor(cpuHeadroom / cpuPerActiveJob)
      : null;

  if (hasError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-10 text-center">
          <XCircle className="mb-3 h-9 w-9 text-destructive" />
          <p className="text-sm text-muted-foreground">{t("system.error")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label={t("system.kpi.onlineWorkers")}
          value={formatNumber(onlineWorkers.length)}
          icon={Server}
          isLoading={isLoading}
        />
        <KpiCard
          label={t("system.kpi.activeJobs")}
          value={`${formatNumber(activeJobs)}/${formatNumber(totalCapacity)}`}
          subtitle={`${formatNumber(availableSlots)} ${t("system.freeSlots")}`}
          icon={Gauge}
          isLoading={isLoading}
        />
        <KpiCard
          label={t("system.kpi.avgCpu")}
          value={formatPercent(avgCpu)}
          subtitle={`${t("system.cpuHeadroom")}: ${formatPercent(cpuHeadroom)}`}
          icon={Cpu}
          isLoading={isLoading}
        />
        <KpiCard
          label={t("system.kpi.cpuPerJob")}
          value={formatPercent(cpuPerActiveJob)}
          subtitle={`${formatNumber(measuredCpuRows.length)} ${t("system.kpi.measuredJobs")}`}
          icon={Activity}
          isLoading={isLoading}
        />
        <KpiCard
          label={t("system.kpi.ram")}
          value={`${formatMb(ramUsedMb)} / ${formatMb(ramTotalMb)}`}
          icon={MemoryStick}
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4 text-muted-foreground" />
              {t("system.workers")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-28 w-full" />
                ))}
              </div>
            ) : onlineWorkers.length === 0 ? (
              <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                {t("system.noWorkers")}
              </div>
            ) : (
              <div className="space-y-3">
                {onlineWorkers.map((worker, workerIndex) => {
                  const latest = latestByWorker.get(worker.workerId);
                  const workerName = formatWorkerDisplayName(worker, workerIndex);
                  const cpu =
                    worker.systemMetrics?.cpuPercent ??
                    toNumber(latest?.cpuPercent);
                  const ram =
                    worker.systemMetrics?.ramPercent ??
                    toNumber(latest?.ramPercent);
                  const processCount = buildProcessRows([worker]).length;
                  const capacityPercent =
                    worker.maxConcurrentAgents > 0
                      ? Math.round(
                          (worker.activeJobs / worker.maxConcurrentAgents) *
                            100,
                        )
                      : 0;
                  const ramUsed =
                    worker.systemMetrics?.ramUsedMb ?? latest?.ramUsedMb;
                  const ramTotal =
                    worker.systemMetrics?.ramTotalMb ?? latest?.ramTotalMb;
                  const systemAvailable = worker.systemMetrics?.ramSystemAvailableMb;
                  const reserved = worker.systemMetrics?.ramReservedMb;
                  const availableForRunners =
                    worker.systemMetrics?.ramAvailableForRunnersMb ??
                    worker.ramAvailableMb;
                  const committed = worker.ramCommittedMb;
                  const budget = worker.ramBudgetMb;

                  return (
                    <div
                      key={worker.workerId}
                      className="rounded-xl border bg-background/60 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold">
                              {workerName}
                            </p>
                            <Badge
                              variant={
                                worker.status === "online"
                                  ? "default"
                                  : "destructive"
                              }
                            >
                              {worker.status}
                            </Badge>
                            {worker.isDraining && (
                              <Badge variant="outline">draining</Badge>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {worker.availableSlots} {t("system.freeSlots")} ·{" "}
                            {processCount} {t("system.processes")} ·{" "}
                            {formatShortId(worker.workerId)}
                          </p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <p className="font-mono tabular-nums text-foreground">
                            {worker.activeJobs}/{worker.maxConcurrentAgents}
                          </p>
                          <p>{t("system.capacity")}</p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        <MemoryStat
                          label={t("system.memory.systemAvailable")}
                          value={formatMb(systemAvailable)}
                        />
                        <MemoryStat
                          label={t("system.memory.reserved")}
                          value={formatMb(reserved)}
                        />
                        <MemoryStat
                          label={t("system.memory.runnerAvailable")}
                          value={formatMb(availableForRunners)}
                        />
                        <MemoryStat
                          label={t("system.memory.committed")}
                          value={formatMb(committed)}
                        />
                        <MemoryStat
                          label={t("system.memory.budget")}
                          value={formatMb(budget)}
                        />
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>CPU</span>
                            <span className="font-mono tabular-nums">
                              {formatPercent(cpu)}
                            </span>
                          </div>
                          <Progress value={cpu} className="h-1.5" />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>RAM</span>
                            <span className="font-mono tabular-nums">
                              {formatMb(ramUsed)} / {formatMb(ramTotal)}
                            </span>
                          </div>
                          <Progress value={ram} className="h-1.5" />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{t("system.capacity")}</span>
                            <span className="font-mono tabular-nums">
                              {capacityPercent}%
                            </span>
                          </div>
                          <Progress value={capacityPercent} className="h-1.5" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Container className="h-4 w-4 text-muted-foreground" />
              {t("system.processTable")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 w-full" />
                ))}
              </div>
            ) : processRows.length === 0 ? (
              <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                {t("system.noProcesses")}
              </div>
            ) : (
              <div className="space-y-2">
                {processRows.slice(0, 12).map((process) => (
                  <div
                    key={process.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px]"
                        >
                          {process.kind}
                        </Badge>
                        <span className="truncate text-sm font-medium">
                          {process.title}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {process.worker} · {process.subtitle}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        Created {formatDateTime(process.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right text-xs font-mono tabular-nums">
                        <p>
                          {process.cpuPercent == null
                            ? "—"
                            : formatPercent(process.cpuPercent)}
                        </p>
                        <p className="text-muted-foreground">
                          {formatMb(process.memoryMb)}
                          {process.memoryLimitMb != null
                            ? ` / ${formatMb(process.memoryLimitMb)}`
                            : ""}
                        </p>
                        <p className="text-muted-foreground">
                          {t("system.memory.jobForecast")}: {formatMb(process.forecastMemoryMb)}
                        </p>
                      </div>
                      {process.canCancel && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={t("system.cancelJob")}
                          disabled={isCancellingJob}
                          onClick={() => void handleCancelJob(process.jobId)}
                        >
                          <Ban className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="gap-1.5">
          <Gauge className="h-3 w-3" />
          {activeJobs}/{totalCapacity} {t("system.capacity")}
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <Cpu className="h-3 w-3" />
          {t("system.cpuHeadroom")}: {formatPercent(cpuHeadroom)}
        </Badge>
        {cpuOnlyExtraSlots != null && (
          <Badge variant="outline" className="gap-1.5">
            <Activity className="h-3 w-3" />
            {t("system.estimatedCpuSlots")}: +{formatNumber(cpuOnlyExtraSlots)}
          </Badge>
        )}
        {data?.generatedAt && (
          <span>
            {t("system.updatedAt")}{" "}
            {new Date(data.generatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      <ConfirmDialog
        isOpen={confirmDialogProps.isOpen}
        options={confirmDialogProps.options}
        onConfirm={confirmDialogProps.handleConfirm}
        onCancel={confirmDialogProps.handleCancel}
      />
    </div>
  );
};

export const AnalyticsPageContainer: React.FC = () => {
  const t = useTranslations("analytics");
  const {
    overview,
    trends,
    users,
    systemMonitoring,
    isLoading,
    isSystemMonitoringLoading,
    error,
    systemMonitoringError,
    cancelJob,
    isCancellingJob,
  } = useAnalyticsPage();

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => b.totalSeconds - a.totalSeconds),
    [users],
  );

  const maxTrendSeconds = Math.max(
    ...trends.map((entry) => entry.totalSeconds),
    0,
  );

  if (error) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] space-y-6 p-6">
          <div>
            <h1 className="text-3xl font-bold">{t("title")}</h1>
            <p className="text-muted-foreground">{t("description")}</p>
          </div>
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <XCircle className="mb-3 h-9 w-9 text-destructive" />
              <p className="text-sm text-muted-foreground">
                Unable to load analytics data.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1200px] space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{t("title")}</h1>
            <p className="text-muted-foreground">{t("description")}</p>
          </div>
        </div>

        <Tabs defaultValue="usage" className="space-y-4">
          <TabsList>
            <TabsTrigger value="usage">{t("tabs.usage")}</TabsTrigger>
            <TabsTrigger value="system">{t("tabs.system")}</TabsTrigger>
          </TabsList>

          <TabsContent value="usage" className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label={t("kpi.totalMinutes")}
                value={formatMinutes(
                  overview?.currentMonthUsage.totalSeconds ?? 0,
                )}
                icon={Clock3}
                isLoading={isLoading}
              />
              <KpiCard
                label={t("kpi.totalSessions")}
                value={formatNumber(overview?.totalAiSessions ?? 0)}
                icon={Activity}
                isLoading={isLoading}
              />
              <KpiCard
                label={t("kpi.activeUsers")}
                value={formatNumber(overview?.activeUsers ?? 0)}
                icon={Users}
                isLoading={isLoading}
              />
              <KpiCard
                label={t("kpi.activeProjects")}
                value={formatNumber(overview?.activeProjects ?? 0)}
                icon={FolderKanban}
                isLoading={isLoading}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    {t("charts.monthlyTrend")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex h-64 items-end gap-2">
                      {Array.from({ length: 12 }).map((_, index) => (
                        <Skeleton
                          key={index}
                          className="flex-1 rounded-t-md"
                          style={{ height: `${30 + (index % 5) * 18}px` }}
                        />
                      ))}
                    </div>
                  ) : trends.length === 0 || maxTrendSeconds === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                      {t("table.noData")}
                    </div>
                  ) : (
                    <div className="flex h-64 items-end gap-2">
                      {trends
                        .slice()
                        .reverse()
                        .map((entry) => {
                          const height = Math.max(
                            8,
                            Math.round(
                              (entry.totalSeconds / maxTrendSeconds) * 100,
                            ),
                          );
                          return (
                            <div
                              key={entry.period}
                              className="flex min-w-0 flex-1 flex-col items-center gap-2"
                            >
                              <div className="flex h-52 w-full items-end">
                                <div
                                  className="w-full rounded-t-md bg-primary/75 transition-colors hover:bg-primary"
                                  style={{ height: `${height}%` }}
                                  title={`${entry.period}: ${formatMinutes(entry.totalSeconds)} ${t("yAxis.minutes")}`}
                                />
                              </div>
                              <span className="truncate text-[11px] text-muted-foreground">
                                {periodLabel(entry.period)}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    {t("charts.topUsers")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Skeleton key={index} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : sortedUsers.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                      {t("table.noData")}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sortedUsers.slice(0, 5).map((user) => (
                        <div
                          key={user.userId}
                          className="flex items-center justify-between gap-4 rounded-lg border p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {user.userName ||
                                user.userEmail ||
                                t("table.unknown")}
                            </p>
                            {user.userEmail && (
                              <p className="truncate text-xs text-muted-foreground">
                                {user.userEmail}
                              </p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold">
                              {formatMinutes(user.totalSeconds)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("table.minutes")}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="system" forceMount>
            <SystemMonitoringPanel
              data={systemMonitoring}
              isLoading={isSystemMonitoringLoading}
              hasError={!!systemMonitoringError}
              t={t}
              onCancelJob={cancelJob}
              isCancellingJob={isCancellingJob}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
