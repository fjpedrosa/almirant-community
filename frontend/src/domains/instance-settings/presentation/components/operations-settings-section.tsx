import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ServerCog,
  XCircle,
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
import type {
  ControllableInstanceService,
  InstanceServiceState,
  OperationsSectionProps,
} from "../../domain/types";

const stateVariant = (state: InstanceServiceState) => {
  if (state === "healthy") return "default";
  if (state === "degraded" || state === "unknown") return "secondary";
  if (state === "down") return "destructive";
  return "outline";
};

const stateIcon = (state: InstanceServiceState) => {
  if (state === "healthy") return CheckCircle2;
  if (state === "down") return XCircle;
  return AlertTriangle;
};

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(timestamp));
};

export const OperationsSettingsSection = ({
  status,
  isLoading,
  isError,
  isStartingOperation,
  onRefresh,
  onRestartService,
  onCleanupExitedContainers,
}: OperationsSectionProps) => {
  const t = useTranslations("instanceSettings.operations");

  const handleRestart = (service: ControllableInstanceService) => {
    const hasActiveRunnerJobs =
      service === "runner" && (status?.activeRunnerJobs ?? 0) > 0;

    if (hasActiveRunnerJobs) {
      const confirmed = window.confirm(t("confirm.forceRunnerRestart"));
      if (!confirmed) return;
      onRestartService(service, { force: true });
      return;
    }

    const confirmed = window.confirm(t("confirm.restartService", {
      service: t(`services.${service}`),
    }));
    if (!confirmed) return;
    onRestartService(service);
  };

  const handleCleanup = () => {
    const confirmed = window.confirm(t("confirm.cleanupExited"));
    if (!confirmed) return;
    onCleanupExitedContainers();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCog className="h-5 w-5" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        </CardContent>
      </Card>
    );
  }

  const activeOperation = status?.activeOperation ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ServerCog className="h-5 w-5" />
              {t("title")}
            </CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("refresh")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("errorTitle")}</AlertTitle>
            <AlertDescription>{t("errorDescription")}</AlertDescription>
          </Alert>
        )}

        {!status?.updaterAvailable && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t("updaterUnavailableTitle")}</AlertTitle>
            <AlertDescription>{t("updaterUnavailableDescription")}</AlertDescription>
          </Alert>
        )}

        {activeOperation && (
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>{t("activeOperation.title")}</AlertTitle>
            <AlertDescription>
              {t("activeOperation.description", {
                status: activeOperation.status,
                step: activeOperation.step ?? "—",
                startedAt: formatDateTime(activeOperation.startedAt),
              })}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t("summary.queued")}</p>
            <p className="mt-1 text-2xl font-semibold">{status?.queuedJobs ?? 0}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              {t("summary.activeRunnerJobs")}
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {status?.activeRunnerJobs ?? 0}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              {t("summary.exitedContainers")}
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {status?.agentContainers.exited ?? 0}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">{t("servicesTitle")}</h3>
              <p className="text-xs text-muted-foreground">
                {t("servicesDescription")}
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            {(status?.services ?? []).map((service) => {
              const Icon = stateIcon(service.state);
              const isRunnerWithActiveJobs =
                service.service === "runner" &&
                (status?.activeRunnerJobs ?? 0) > 0;
              const disabled =
                !status?.updaterAvailable ||
                isStartingOperation ||
                service.state === "not_configured";

              return (
                <div
                  key={service.service}
                  className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">
                        {t(`services.${service.service}`)}
                      </span>
                      <Badge variant={stateVariant(service.state)}>
                        {t(`state.${service.state}`)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("serviceRuntime", {
                        composeState: service.composeState ?? "—",
                        health: service.health ?? "—",
                      })}
                    </p>
                    {isRunnerWithActiveJobs && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {t("runnerActiveWarning", {
                          count: status?.activeRunnerJobs ?? 0,
                        })}
                      </p>
                    )}
                  </div>
                  <Button
                    variant={isRunnerWithActiveJobs ? "destructive" : "outline"}
                    size="sm"
                    disabled={disabled}
                    onClick={() => handleRestart(service.service)}
                  >
                    {isStartingOperation ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="mr-2 h-4 w-4" />
                    )}
                    {isRunnerWithActiveJobs
                      ? t("forceRestart")
                      : t("restart")}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-md border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">{t("containers.title")}</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("containers.description", {
                  running: status?.agentContainers.running ?? 0,
                  exited: status?.agentContainers.exited ?? 0,
                })}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={
                !status?.updaterAvailable ||
                isStartingOperation ||
                (status?.agentContainers.exited ?? 0) === 0
              }
              onClick={handleCleanup}
            >
              {isStartingOperation ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t("containers.cleanup")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
