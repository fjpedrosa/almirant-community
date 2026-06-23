"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Clock, RefreshCw, ShieldAlert, X } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useAgentRuns, useInfiniteAgentJobLogs } from "../../application/hooks/use-agent-run-logs";
import { useLiveTimer } from "../../application/hooks/use-live-timer";
import { AgentRunsTable } from "../components/agent-runs-table";
import { AgentJobLogsTimeline } from "../components/agent-job-logs-timeline";
import { AgentJobStatusBadge } from "../components/agent-job-status-badge";
import {
  classifyRootCause,
  formatRunDateTime,
  formatRunDuration,
  getRunDurationMs,
  parseRootCause,
  resolveRunLastEvent,
  resolveRunModel,
} from "../../domain/run-utils";
import type { AgentJobLogLevel, AgentJobLogsFilters } from "../../domain/types";

const LOG_PAGE_SIZE = 100;

const ACTIVE_STATUSES = new Set(["queued", "running", "finalizing", "waiting_for_input", "paused"]);

const toLocalDateTimeInput = (iso: string | undefined): string => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const toIsoDateTime = (value: string): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

export const AgentRunsMonitoringContainer: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedJobId = searchParams.get("jobId");
  const level = (searchParams.get("level") ?? undefined) as AgentJobLogLevel | undefined;
  const phase = searchParams.get("phase") ?? undefined;
  const eventType = searchParams.get("eventType") ?? undefined;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  const { runs, isLoading, isFetching, isError, refetch } = useAgentRuns({
    page: 1,
    limit: 40,
  });

  const hasActiveRuns = runs.some((run) => ACTIVE_STATUSES.has(run.status));
  const currentTime = useLiveTimer(hasActiveRuns);

  const selectedJob = useMemo(
    () => runs.find((job) => job.id === selectedJobId) ?? runs[0] ?? null,
    [runs, selectedJobId]
  );

  const updateQuery = useCallback(
    (patch: Record<string, string | undefined | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (!value) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (!selectedJobId && runs.length > 0) {
      updateQuery({ jobId: runs[0]?.id });
    }
  }, [runs, selectedJobId, updateQuery]);

  const filters = useMemo<AgentJobLogsFilters>(
    () => ({
      level,
      phase,
      eventType,
      from,
      to,
      limit: LOG_PAGE_SIZE,
    }),
    [eventType, from, level, phase, to]
  );

  const logsQuery = useInfiniteAgentJobLogs(selectedJob?.id, filters, {
    enabled: !!selectedJob,
    isActiveJob: selectedJob ? ACTIVE_STATUSES.has(selectedJob.status) : false,
  });

  const rootCause = useMemo(
    () => parseRootCause(selectedJob?.errorMessage ?? null),
    [selectedJob?.errorMessage]
  );

  const rootCauseCategory = useMemo(
    () => (rootCause ? classifyRootCause(rootCause) : null),
    [rootCause]
  );

  const handleLoadMoreLogs = () => {
    if (!logsQuery.hasMore) return;
    void logsQuery.fetchNextPage();
  };

  const handleRefresh = async () => {
    await Promise.all([refetch(), logsQuery.refetch()]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Agent Runs</h2>
          <p className="text-sm text-muted-foreground">
            Recent runs, model/provider metadata, and a live timeline of structured logs.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isFetching || logsQuery.isFetching}
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${(isFetching || logsQuery.isFetching) ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <AgentRunsTable
          title="Recent Runs"
          jobs={runs}
          selectedJobId={selectedJob?.id ?? null}
          onSelectJob={(jobId) => updateQuery({ jobId })}
          currentTime={currentTime}
          isLoading={isLoading}
          isError={isError}
          emptyLabel="No agent runs available yet."
        />

        <div className="space-y-3">
          {selectedJob ? (
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Run Details</p>
                  <p className="text-xs text-muted-foreground break-all">
                    Job ID: {selectedJob.id}
                  </p>
                </div>
                <AgentJobStatusBadge
                  status={selectedJob.status}
                  errorType={selectedJob.errorType}
                  errorMessage={selectedJob.errorMessage}
                />
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd className="font-medium">{selectedJob.provider}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="font-medium">{resolveRunModel(selectedJob)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Started</dt>
                  <dd>{formatRunDateTime(selectedJob.startedAt ?? selectedJob.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Finished</dt>
                  <dd>{formatRunDateTime(selectedJob.completedAt ?? selectedJob.failedAt ?? null)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="font-medium tabular-nums">
                    {formatRunDuration(getRunDurationMs(selectedJob, currentTime))}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last Event</dt>
                  <dd className="truncate">{resolveRunLastEvent(selectedJob)}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="rounded-lg border p-3 text-sm text-muted-foreground">
              Select a run to inspect logs.
            </div>
          )}

          {selectedJob?.status === "failed" && rootCause && (
            <Alert variant="destructive" className="border-destructive/50 bg-destructive/5">
              {rootCauseCategory === "auth" ? (
                <ShieldAlert className="h-4 w-4" />
              ) : rootCauseCategory === "rate_limit" ? (
                <Clock className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertTitle className="text-sm">
                {rootCauseCategory === "auth"
                  ? "Authentication Failed"
                  : rootCauseCategory === "rate_limit"
                    ? "Rate Limit Exceeded"
                    : "Root Cause Detected"}
              </AlertTitle>
              <AlertDescription className="text-xs">
                <code className="rounded bg-destructive/10 px-1 py-0.5 font-mono text-[11px]">
                  {rootCause}
                </code>
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Log Filters</p>
              {(level || phase || eventType || from || to) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    updateQuery({
                      level: undefined,
                      phase: undefined,
                      eventType: undefined,
                      from: undefined,
                      to: undefined,
                    })
                  }
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Level</Label>
                <Select
                  value={level ?? "all"}
                  onValueChange={(value) =>
                    updateQuery({ level: value === "all" ? undefined : value })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="All levels" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All levels</SelectItem>
                    <SelectItem value="debug">debug</SelectItem>
                    <SelectItem value="info">info</SelectItem>
                    <SelectItem value="warn">warn</SelectItem>
                    <SelectItem value="error">error</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Phase</Label>
                <Input
                  className="h-8"
                  value={phase ?? ""}
                  onChange={(event) =>
                    updateQuery({ phase: event.target.value || undefined })
                  }
                  placeholder="e.g. session"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Event Type</Label>
                <Input
                  className="h-8"
                  value={eventType ?? ""}
                  onChange={(event) =>
                    updateQuery({ eventType: event.target.value || undefined })
                  }
                  placeholder="e.g. session.created"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">From</Label>
                <Input
                  type="datetime-local"
                  className="h-8"
                  value={toLocalDateTimeInput(from)}
                  onChange={(event) =>
                    updateQuery({ from: toIsoDateTime(event.target.value) })
                  }
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">To</Label>
                <Input
                  type="datetime-local"
                  className="h-8"
                  value={toLocalDateTimeInput(to)}
                  onChange={(event) =>
                    updateQuery({ to: toIsoDateTime(event.target.value) })
                  }
                />
              </div>
            </div>
          </div>

          <AgentJobLogsTimeline
            title="Run Timeline"
            logs={logsQuery.logs}
            isLoading={logsQuery.isLoading}
            isError={logsQuery.isError}
            hasMore={logsQuery.hasMore}
            onLoadMore={handleLoadMoreLogs}
            isLoadingMore={logsQuery.isFetchingNextPage}
            emptyLabel={selectedJob ? "No logs for this run yet." : "Select a run first."}
          />
        </div>
      </div>
    </div>
  );
};
