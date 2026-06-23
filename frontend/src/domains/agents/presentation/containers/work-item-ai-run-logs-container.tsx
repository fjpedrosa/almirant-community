"use client";

import { useMemo, useState } from "react";
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
import { AlertCircle, Clock, Copy, RefreshCw, ShieldAlert } from "lucide-react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useInfiniteAgentJobLogs, useAgentRunsByWorkItem, useAgentTranscript } from "../../application/hooks/use-agent-run-logs";
import { useLiveTimer } from "../../application/hooks/use-live-timer";
import { SessionTranscript } from "@/domains/sessions/presentation/components/session-transcript";
import { AgentJobLogsTimeline } from "../components/agent-job-logs-timeline";
import { AgentJobStatusBadge } from "../components/agent-job-status-badge";
import {
  classifyRootCause,
  formatRunDateTime,
  formatRunDuration,
  getRunDurationMs,
  parseRootCause,
  resolveRunLastError,
  resolveRunModel,
} from "../../domain/run-utils";
import type { AgentJobLogLevel, AgentJobLogsFilters } from "../../domain/types";

interface WorkItemAiRunLogsContainerProps {
  workItemId: string;
}

type RunLogsViewMode = "logs" | "transcript";

const LOG_PAGE_SIZE = 100;
const ACTIVE_STATUSES = new Set(["queued", "running", "finalizing", "waiting_for_input", "paused"]);

const toIsoDateTime = (value: string): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

// @ce-patch: inline useAgentRunConversation (EE hook lives in backoffice domain).
// Maps non-tool-use chunks to assistant messages — a minimal substitute for the
// EE hook. Keeps the transcript tab functional in CE without pulling EE code.
const useAgentRunConversation = (chunks: readonly unknown[]) => ({
  messages: chunks.map((c, i) => {
    const chunk = (c ?? {}) as { seq?: number; message?: string; timestamp?: string };
    return {
      id: String(chunk.seq ?? i),
      role: "assistant" as const,
      content: String(chunk.message ?? ""),
      timestamp: chunk.timestamp,
    };
  }),
  streamingBlocks: [] as never[],
});

export const WorkItemAiRunLogsContainer: React.FC<WorkItemAiRunLogsContainerProps> = ({
  workItemId,
}) => {
  const [viewMode, setViewMode] = useState<RunLogsViewMode>("logs");
  const [manualSelectedJobId, setManualSelectedJobId] = useState<string | null>(null);
  const [level, setLevel] = useState<AgentJobLogLevel | undefined>(undefined);
  const [phase, setPhase] = useState<string>("");
  const [eventType, setEventType] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const runsQuery = useAgentRunsByWorkItem(workItemId);
  const runs = runsQuery.runs;
  const hasActiveRuns = runs.some((run) => ACTIVE_STATUSES.has(run.status));
  const currentTime = useLiveTimer(hasActiveRuns);

  const selectedJobId = useMemo(() => {
    if (!runs.length) return "";
    if (manualSelectedJobId && runs.some((run) => run.id === manualSelectedJobId)) {
      return manualSelectedJobId;
    }
    return runs[0]!.id;
  }, [manualSelectedJobId, runs]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedJobId) ?? null,
    [runs, selectedJobId]
  );

  const filters = useMemo<AgentJobLogsFilters>(
    () => ({
      level,
      phase: phase || undefined,
      eventType: eventType || undefined,
      from: toIsoDateTime(from),
      to: toIsoDateTime(to),
      limit: LOG_PAGE_SIZE,
    }),
    [eventType, from, level, phase, to]
  );

  const logsQuery = useInfiniteAgentJobLogs(selectedRun?.id, filters, {
    enabled: !!selectedRun && viewMode === "logs",
    isActiveJob: selectedRun ? ACTIVE_STATUSES.has(selectedRun.status) : false,
  });

  const transcriptQuery = useAgentTranscript(selectedRun?.id, {
    enabled: !!selectedRun && viewMode === "transcript",
  });

  const { messages, streamingBlocks } = useAgentRunConversation(transcriptQuery.chunks);
  const isStreaming = selectedRun ? ACTIVE_STATUSES.has(selectedRun.status) : false;

  const rootCause = useMemo(
    () => parseRootCause(selectedRun?.errorMessage ?? null),
    [selectedRun?.errorMessage]
  );

  const rootCauseCategory = useMemo(
    () => (rootCause ? classifyRootCause(rootCause) : null),
    [rootCause]
  );

  const handleLoadMoreLogs = () => {
    if (!logsQuery.hasMore) return;
    void logsQuery.fetchNextPage();
  };

  const handleCopy = async (value: string | null, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast.success(`${label} copied`);
    } catch {
      showToast.error("Failed to copy value");
    }
  };

  const resetFilters = () => {
    setLevel(undefined);
    setPhase("");
    setEventType("");
    setFrom("");
    setTo("");
  };

  if (!runsQuery.isLoading && runs.length === 0) {
    return (
      <div className="mt-4 rounded-lg border p-3">
        <p className="text-sm font-medium">AI Run Logs</p>
        <p className="mt-1 text-sm text-muted-foreground">
          No runs found for this work item yet.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">AI Run Logs</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            void Promise.all([runsQuery.refetch(), logsQuery.refetch()]);
          }}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Run</Label>
          <Select
            value={selectedJobId || undefined}
            onValueChange={(jobId) => setManualSelectedJobId(jobId)}
            disabled={runsQuery.isLoading || runs.length === 0}
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Select a run" />
            </SelectTrigger>
            <SelectContent>
              {runs.map((run) => (
                <SelectItem key={run.id} value={run.id}>
                  {run.provider} · {formatRunDateTime(run.startedAt ?? run.createdAt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedRun && (
          <div className="rounded-md border p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Status</span>
              <AgentJobStatusBadge
                status={selectedRun.status}
                errorType={selectedRun.errorType}
                errorMessage={selectedRun.errorMessage}
              />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
              <div>
                <dt className="text-muted-foreground">Provider</dt>
                <dd>{selectedRun.provider}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Model</dt>
                <dd className="truncate">{resolveRunModel(selectedRun)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Started</dt>
                <dd>{formatRunDateTime(selectedRun.startedAt ?? selectedRun.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Finished</dt>
                <dd>{formatRunDateTime(selectedRun.completedAt ?? selectedRun.failedAt ?? null)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="tabular-nums font-medium">
                  {formatRunDuration(getRunDurationMs(selectedRun, currentTime))}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Job ID</dt>
                <dd className="truncate font-mono">{selectedRun.id}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {selectedRun?.status === "failed" && (rootCause || selectedRun.errorMessage) && (
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
                : rootCause
                  ? "Root Cause Detected"
                  : "Execution Failed"}
          </AlertTitle>
          <AlertDescription className="text-xs">
            <code className="rounded bg-destructive/10 px-1 py-0.5 font-mono text-[11px]">
              {rootCause ?? selectedRun.errorMessage}
            </code>
          </AlertDescription>
        </Alert>
      )}

      {selectedRun && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => handleCopy(selectedRun.sessionId ?? null, "Session ID")}
            disabled={!selectedRun.sessionId}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Copy sessionId
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() =>
              handleCopy(resolveRunLastError(selectedRun, logsQuery.logs), "Last error")
            }
            disabled={!resolveRunLastError(selectedRun, logsQuery.logs)}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Copy last error
          </Button>
        </div>
      )}

      <div className="flex gap-1 border-b pb-0">
        <button
          type="button"
          className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
            viewMode === "logs"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setViewMode("logs")}
        >
          Structured Logs
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
            viewMode === "transcript"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setViewMode("transcript")}
        >
          Transcript
        </button>
      </div>

      {viewMode === "logs" && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Level</Label>
              <Select
                value={level ?? "all"}
                onValueChange={(value) => setLevel(value === "all" ? undefined : (value as AgentJobLogLevel))}
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
                value={phase}
                onChange={(event) => setPhase(event.target.value)}
                placeholder="e.g. git"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Event Type</Label>
              <Input
                className="h-8"
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
                placeholder="e.g. session.created"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="datetime-local"
                className="h-8"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="datetime-local"
                className="h-8"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>

            <div className="flex items-end">
              <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={resetFilters}>
                Clear filters
              </Button>
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
          />
        </>
      )}

      {viewMode === "transcript" && (
        <div className="rounded-lg border bg-card">
          <div className="max-h-[400px] overflow-auto p-4">
            {transcriptQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ) : transcriptQuery.chunks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No transcript available for this run.
              </p>
            ) : (
              <SessionTranscript
                messages={messages}
                streamingBlocks={streamingBlocks}
                transcript=""
                isStreaming={isStreaming}
                isLoading={false}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
