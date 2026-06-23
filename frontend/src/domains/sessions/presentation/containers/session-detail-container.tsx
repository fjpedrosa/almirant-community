"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, MemoryStick, Square, TerminalSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AgentJobStatusBadge } from "@/domains/agents/presentation/components/agent-job-status-badge";
import { AgentLogViewer } from "@/domains/shared/presentation/components/agent-log-viewer";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { useLiveTimer } from "@/domains/agents/application/hooks/use-live-timer";
import { useAgentTranscript } from "@/domains/agents/application/hooks/use-agent-run-logs";
import {
  useSessionDetail,
  useSessionOutput,
  isAgentSessionActive,
} from "../../application/hooks/use-session-detail";
import { useSessionControls } from "../../application/hooks/use-session-controls";
import {
  resolveModel,
  resolveSkill,
  getSessionDurationMs,
  formatDuration,
  resolveSessionDisplayTitle,
  resolveSessionHeadline,
} from "../../domain/utils";

type SessionTab = "output" | "transcript";

interface SessionDetailContainerProps {
  sessionId: string;
}

const LoadingState = () => (
  <div className="space-y-6 p-6">
    <Skeleton className="h-9 w-36" />
    <Skeleton className="h-10 w-72" />
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-[520px] w-full" />
    </div>
  </div>
);

const formatMemoryValue = (value: number, maximumFractionDigits = 1): string =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);

const formatMb = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  if (value >= 1024) return `${formatMemoryValue(value / 1024)} GB`;
  return `${formatMemoryValue(Math.round(value), 0)} MB`;
};

export const SessionDetailContainer: React.FC<SessionDetailContainerProps> = ({
  sessionId,
}) => {
  const router = useRouter();
  const t = useTranslations("sessions");
  const { formatDateTime } = useFormattedDate();

  const { data: detail, isLoading, error } = useSessionDetail(sessionId);
  const isLive = isAgentSessionActive(detail?.job.status);
  const currentTime = useLiveTimer(isLive);

  const controls = useSessionControls({
    jobId: sessionId,
    status: detail?.job.status ?? "queued",
  });

  const [activeTab, setActiveTab] = useState<SessionTab>("output");

  const output = useSessionOutput(sessionId, detail?.job.status, {
    enabled: !!detail,
    provider: detail?.job.provider ?? null,
  });

  const transcriptQuery = useAgentTranscript(detail?.job.id, {
    enabled: !!detail && activeTab === "transcript",
  });

  const workItemHref = detail?.workItem?.id && detail?.board?.area
    ? `/board/${detail.board.area}?workItemId=${detail.workItem.id}`
    : null;
  const resourceEstimate = detail?.job.config?.resourceEstimate ?? null;

  const duration = useMemo(
    () =>
      detail
        ? formatDuration(
            getSessionDurationMs(
              detail.job.startedAt,
              detail.job.completedAt ?? detail.job.failedAt ?? null,
              detail.job.durationMs,
              currentTime
            )
          )
        : "-",
    [currentTime, detail]
  );

  if (isLoading) {
    return <LoadingState />;
  }

  if (!detail) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : t("detail.notFound")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Button variant="ghost" onClick={() => router.push("/sessions")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("detail.back")}
      </Button>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <TerminalSquare className="h-3.5 w-3.5" />
            {resolveSessionDisplayTitle(detail.job, {
              planningSessionTitle: detail.planningSession?.title ?? null,
            })}
          </Badge>
          <AgentJobStatusBadge status={detail.job.status} />
          {isLive && <Badge>{t("detail.live")}</Badge>}
          <span className="text-sm text-muted-foreground font-mono tabular-nums">
            {duration}
          </span>
          {controls.isActive && (
            <Button
              variant="destructive"
              size="sm"
              disabled={controls.isCancelling}
              onClick={controls.onStop}
            >
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {controls.isCancelling ? "Stopping…" : "Stop"}
            </Button>
          )}
        </div>

        <h1 className="text-2xl font-bold">
          {resolveSessionHeadline(detail.job, {
            planningSessionTitle: detail.planningSession?.title ?? null,
          })}
        </h1>
        <p className="text-muted-foreground">{t("detail.description")}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.runDetails")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.provider")}
              </p>
              <p>{detail.job.provider}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.model")}
              </p>
              <p>{resolveModel(detail.job.model, detail.job.config?.model, detail.job.result?.model)}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.type")}
              </p>
              <p>{resolveSkill(detail.job.jobType, detail.job.config?.skillName)}</p>
            </div>

            {resourceEstimate && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <MemoryStick className="h-3.5 w-3.5" />
                    Estimated RAM
                  </p>
                  <Badge variant="outline">{resourceEstimate.confidence}</Badge>
                </div>
                <p className="text-lg font-semibold tabular-nums">
                  {formatMb(resourceEstimate.estimatedMemoryMb)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {resourceEstimate.reason ??
                    `${resourceEstimate.source} resource estimate`}
                </p>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.started")}
              </p>
              <p>{formatDateTime(detail.job.startedAt ?? detail.job.createdAt)}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.finished")}
              </p>
              <p>
                {detail.job.completedAt || detail.job.failedAt
                  ? formatDateTime(detail.job.completedAt ?? detail.job.failedAt!)
                  : "-"}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.duration")}
              </p>
              <p>{duration}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.project")}
              </p>
              <p>{detail.project?.name ?? "-"}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.board")}
              </p>
              <p>{detail.board?.name ?? "-"}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.createdBy")}
              </p>
              <p>{detail.createdByUser?.name ?? "-"}</p>
            </div>

            {detail.job.errorMessage && (
              <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-destructive">
                  {t("detail.error")}
                </p>
                <p className="text-sm text-destructive">{detail.job.errorMessage}</p>
              </div>
            )}

            {workItemHref && (
              <Button asChild className="w-full" variant="outline">
                <Link href={workItemHref}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t("detail.workItem")}
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-0">
          <div className="flex gap-1 border-b pb-0">
            <button
              type="button"
              className={`px-3 py-1.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === "output"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("output")}
            >
              {t("detail.tabOutput")}
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === "transcript"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("transcript")}
            >
              {t("detail.tabTranscript")}
            </button>
          </div>

          {activeTab === "output" && (
            <AgentLogViewer
              chunks={output.chunks}
              isLoading={output.isLoading}
              isLive={isLive}
              title={t("detail.timeline")}
              emptyLabel={t("detail.noOutput")}
            />
          )}

          {activeTab === "transcript" && (
            <div className="mt-2 rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <p className="text-sm font-medium">{t("detail.tabTranscript")}</p>
              </div>
              <div className="max-h-[600px] overflow-auto p-4">
                {transcriptQuery.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                ) : transcriptQuery.transcript ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
                    {transcriptQuery.transcript}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("detail.noTranscript")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
