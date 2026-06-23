import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AgentJobStatusBadge } from "./agent-job-status-badge";
import {
  formatRunDateTime,
  formatRunDuration,
  getRunDurationMs,
  getRunFinishedAt,
  resolveRunLastEvent,
  resolveRunModel,
} from "../../domain/run-utils";
import type { AgentJob } from "../../domain/types";

interface AgentRunsTableProps {
  title?: string;
  jobs: AgentJob[];
  selectedJobId?: string | null;
  onSelectJob?: (jobId: string) => void;
  currentTime: number;
  isLoading: boolean;
  isError?: boolean;
  emptyLabel?: string;
  className?: string;
}

const RowsSkeleton: React.FC = () => (
  <div className="space-y-2">
    {Array.from({ length: 6 }).map((_, idx) => (
      <Skeleton key={idx} className="h-9 w-full" />
    ))}
  </div>
);

export const AgentRunsTable: React.FC<AgentRunsTableProps> = ({
  title = "Agent Runs",
  jobs,
  selectedJobId,
  onSelectJob,
  currentTime,
  isLoading,
  isError = false,
  emptyLabel = "No runs found.",
  className,
}) => {
  const hasRows = jobs.length > 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <RowsSkeleton />
        ) : isError ? (
          <p className="text-sm text-destructive">
            Failed to load runs.
          </p>
        ) : !hasRows ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Finished</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Last Event</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const isSelected = selectedJobId === job.id;
                  const durationMs = getRunDurationMs(job, currentTime);

                  return (
                    <TableRow
                      key={job.id}
                      className={cn(
                        "align-top",
                        onSelectJob && "cursor-pointer",
                        isSelected && "bg-muted/60"
                      )}
                      onClick={() => onSelectJob?.(job.id)}
                      data-testid={`run-row-${job.id}`}
                    >
                      <TableCell>
                        <AgentJobStatusBadge
                          status={job.status}
                          errorType={job.errorType}
                          errorMessage={job.errorMessage}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {job.provider}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                        {resolveRunModel(job)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatRunDateTime(job.startedAt ?? job.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatRunDateTime(getRunFinishedAt(job))}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-xs font-medium tabular-nums"
                        data-testid={`run-duration-${job.id}`}
                      >
                        {formatRunDuration(durationMs)}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                        {resolveRunLastEvent(job)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
