import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Cpu,
  HardDriveDownload,
  MemoryStick,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  CapacitySectionProps,
  CapacityWarningSeverity,
  InstanceCapacityDiagnostics,
} from "../../domain/types";

const formatMb = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1024) {
    const gb = value / 1024;
    return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  }
  return `${value} MB`;
};

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const severityVariant = (
  severity: CapacityWarningSeverity,
): "default" | "secondary" | "destructive" | "outline" => {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "secondary";
  return "outline";
};

const warningMessageKey = (code: string): string => {
  const knownCodes = new Set([
    "no_runner_heartbeat",
    "ram_budget_disabled",
    "reserved_below_recommendation",
    "configured_concurrency_above_safe_max",
    "insufficient_runner_budget",
    "low_upgrade_headroom",
  ]);

  return knownCodes.has(code)
    ? `warnings.messages.${code}`
    : "warnings.messages.unknown";
};

const getCapacityState = (diagnostics: InstanceCapacityDiagnostics) => {
  if (diagnostics.warnings.some((warning) => warning.severity === "critical")) {
    return "critical" as const;
  }
  if (diagnostics.warnings.some((warning) => warning.severity === "warning")) {
    return "warning" as const;
  }
  return "safe" as const;
};

const MetricCard = ({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}) => (
  <div className="rounded-xl border bg-background/70 p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
          {value}
        </p>
      </div>
      <div className="rounded-lg bg-muted p-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
  </div>
);

const CapacityLoading = () => (
  <Card>
    <CardHeader>
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-4 w-full max-w-lg" />
    </CardHeader>
    <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-28 rounded-xl" />
      ))}
    </CardContent>
  </Card>
);

export const CapacitySettingsSection = ({
  diagnostics,
  isLoading,
  isError,
  onRefresh,
  onCancelOrphanedJob,
  onCancelAllOrphanedJobs,
  cancellingOrphanedJobId,
  isCancellingAllOrphanedJobs,
}: CapacitySectionProps) => {
  const t = useTranslations("instanceSettings.capacity");

  if (isLoading) return <CapacityLoading />;

  if (isError || !diagnostics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("errorTitle")}</AlertTitle>
            <AlertDescription>{t("errorDescription")}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const state = getCapacityState(diagnostics);
  const totalConfiguredSlots = diagnostics.workers.reduce(
    (sum, worker) => sum + worker.maxConcurrentAgents,
    0,
  );
  const activeJobs = diagnostics.workers.reduce(
    (sum, worker) => sum + worker.activeJobs,
    0,
  );
  const ramPercent = diagnostics.host.ramTotalMb > 0
    ? clampPercent((diagnostics.host.ramUsedMb / diagnostics.host.ramTotalMb) * 100)
    : 0;
  const runnerBudgetUsedPercent = diagnostics.recommendation.effectiveRunnerBudgetMb > 0
    ? clampPercent(
        ((diagnostics.recommendation.effectiveRunnerBudgetMb -
          Math.max(0, diagnostics.recommendation.upgradeHeadroomMb)) /
          diagnostics.recommendation.effectiveRunnerBudgetMb) *
          100,
      )
    : 0;
  const concurrencyPercent = diagnostics.config.maxConcurrent > 0
    ? clampPercent((activeJobs / diagnostics.config.maxConcurrent) * 100)
    : 0;
  const orphanedJobs = diagnostics.orphanedJobs;
  const hasOrphanedJobs = orphanedJobs.length > 0;

  return (
    <Card data-testid="capacity-settings-section">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              {t("title")}
            </CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={state === "critical" ? "destructive" : "outline"}
              className="capitalize"
            >
              {t(`state.${state}`)}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="cursor-pointer"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("refresh")}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={MemoryStick}
            label={t("metrics.totalRam")}
            value={formatMb(diagnostics.host.ramTotalMb)}
            hint={t("metrics.totalRamHint", {
              source: t(`source.${diagnostics.host.source}`),
            })}
          />
          <MetricCard
            icon={HardDriveDownload}
            label={t("metrics.availableRam")}
            value={formatMb(diagnostics.host.ramAvailableMb)}
            hint={t("metrics.availableRamHint")}
          />
          <MetricCard
            icon={Cpu}
            label={t("metrics.cpuCores")}
            value={String(diagnostics.host.cpuCores)}
            hint={t("metrics.cpuCoresHint")}
          />
          <MetricCard
            icon={ShieldCheck}
            label={t("metrics.safeMax")}
            value={String(diagnostics.recommendation.safeMaxConcurrent)}
            hint={t("metrics.safeMaxHint", {
              configured: diagnostics.config.maxConcurrent,
            })}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{t("guardrails.title")}</h3>
                <p className="text-xs text-muted-foreground">
                  {t("guardrails.description")}
                </p>
              </div>
              {diagnostics.recommendation.isConfiguredSafe ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-background p-3">
                <p className="text-xs text-muted-foreground">
                  {t("guardrails.recommended")}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold">
                  {diagnostics.recommendation.recommendedConcurrent}
                </p>
              </div>
              <div className="rounded-lg bg-background p-3">
                <p className="text-xs text-muted-foreground">
                  {t("guardrails.reserved")}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold">
                  {formatMb(diagnostics.config.reservedMb)}
                </p>
              </div>
              <div className="rounded-lg bg-background p-3">
                <p className="text-xs text-muted-foreground">
                  {t("guardrails.recommendedReserve")}
                </p>
                <p className="mt-1 font-mono text-lg font-semibold">
                  {formatMb(diagnostics.recommendation.recommendedReservedMb)}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("progress.ram")}</span>
                  <span className="font-mono tabular-nums">
                    {formatMb(diagnostics.host.ramUsedMb)} / {formatMb(diagnostics.host.ramTotalMb)}
                  </span>
                </div>
                <Progress value={ramPercent} className="h-1.5" />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("progress.runnerBudget")}</span>
                  <span className="font-mono tabular-nums">
                    {formatMb(diagnostics.recommendation.effectiveRunnerBudgetMb)}
                  </span>
                </div>
                <Progress value={runnerBudgetUsedPercent} className="h-1.5" />
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("progress.concurrency")}</span>
                  <span className="font-mono tabular-nums">
                    {activeJobs}/{diagnostics.config.maxConcurrent}
                  </span>
                </div>
                <Progress value={concurrencyPercent} className="h-1.5" />
              </div>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border bg-background p-4">
            <div>
              <h3 className="text-sm font-semibold">{t("recommendedEnv.title")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("recommendedEnv.description")}
              </p>
            </div>
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                <code>{diagnostics.recommendedEnv}</code>
              </pre>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("recommendedEnv.copy")}
                className="shrink-0 cursor-pointer"
                onClick={() => navigator.clipboard.writeText(diagnostics.recommendedEnv)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("recommendedEnv.hint")}
            </p>
          </div>
        </div>

        {diagnostics.warnings.length > 0 && (
          <div className="space-y-2">
            {diagnostics.warnings.map((warning) => (
              <Alert
                key={warning.code}
                variant={warning.severity === "critical" ? "destructive" : "default"}
              >
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="flex items-center gap-2">
                  {t("warnings.title")}
                  <Badge variant={severityVariant(warning.severity)}>
                    {t(`warnings.severity.${warning.severity}`)}
                  </Badge>
                </AlertTitle>
                <AlertDescription>{t(warningMessageKey(warning.code))}</AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{t("workers.title")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("workers.description")}
              </p>
              {diagnostics.workerCounts.hiddenOffline > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("workers.hiddenOffline", {
                    count: diagnostics.workerCounts.hiddenOffline,
                  })}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {diagnostics.workerCounts.offlineWithOrphanedJobs > 0 && (
                <Badge variant="destructive">
                  {t("workers.offlineWithOrphans", {
                    count: diagnostics.workerCounts.offlineWithOrphanedJobs,
                  })}
                </Badge>
              )}
              <Badge variant="outline">
                {t("workers.summary", {
                  online: diagnostics.workerCounts.online,
                  visible: diagnostics.workerCounts.visible,
                  total: diagnostics.workerCounts.total,
                })}
              </Badge>
              <Badge variant="outline">
                {activeJobs}/{totalConfiguredSlots || diagnostics.config.maxConcurrent} {t("workers.active")}
              </Badge>
            </div>
          </div>

          {diagnostics.workers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("workers.empty")}
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {diagnostics.workers.map((worker) => (
                <div key={worker.workerId} className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {worker.hostname}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {worker.workerId}
                      </p>
                    </div>
                    <Badge variant={worker.status === "online" ? "default" : "destructive"}>
                      {worker.status}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">{t("workers.jobs")}</p>
                      <p className="font-mono font-semibold">
                        {worker.activeJobs}/{worker.maxConcurrentAgents}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("workers.free")}</p>
                      <p className="font-mono font-semibold">{worker.availableSlots}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t("workers.ram")}</p>
                      <p className="font-mono font-semibold">
                        {formatMb(worker.ramAvailableMb)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {hasOrphanedJobs && (
          <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-destructive">
                  {t("orphanedJobs.title")}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t("orphanedJobs.description")}
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="cursor-pointer"
                disabled={isCancellingAllOrphanedJobs}
                onClick={onCancelAllOrphanedJobs}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {isCancellingAllOrphanedJobs
                  ? t("orphanedJobs.cancellingAll")
                  : t("orphanedJobs.cancelAll")}
              </Button>
            </div>

            <div className="space-y-2">
              {orphanedJobs.map((job) => {
                const title = job.workItemTaskId ?? job.workItemTitle ?? job.id;
                const isCancelling =
                  isCancellingAllOrphanedJobs ||
                  cancellingOrphanedJobId === job.id;

                return (
                  <div
                    key={job.id}
                    className="rounded-lg border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="destructive">{job.status}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">
                            {job.id}
                          </span>
                        </div>
                        <p className="truncate text-sm font-semibold">
                          {title}
                        </p>
                        {job.workItemTitle && job.workItemTaskId && (
                          <p className="truncate text-xs text-muted-foreground">
                            {job.workItemTitle}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="cursor-pointer border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isCancelling}
                        onClick={() => onCancelOrphanedJob(job.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {isCancelling
                          ? t("orphanedJobs.cancelling")
                          : t("orphanedJobs.cancel")}
                      </Button>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
                      <div>
                        <p>{t("orphanedJobs.worker")}</p>
                        <p className="font-mono text-foreground">
                          {job.workerHostname ?? job.workerId}
                        </p>
                      </div>
                      <div>
                        <p>{t("orphanedJobs.started")}</p>
                        <p className="font-mono text-foreground">
                          {formatDateTime(job.startedAt)}
                        </p>
                      </div>
                      <div>
                        <p>{t("orphanedJobs.skill")}</p>
                        <p className="font-mono text-foreground">
                          {job.promptTemplate ?? job.skillName ?? job.jobType ?? "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Alert>
          <Zap className="h-4 w-4" />
          <AlertTitle>{t("upgrade.title")}</AlertTitle>
          <AlertDescription>
            {t("upgrade.description", {
              headroom: formatMb(diagnostics.recommendation.upgradeHeadroomMb),
            })}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
