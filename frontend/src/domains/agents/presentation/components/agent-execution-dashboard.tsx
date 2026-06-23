import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Bot,
  ExternalLink,
  GitBranch,
} from "lucide-react";
import type { AgentDashboardProps, AgentJob } from "../../domain/types";

const statusBadgeVariant = (
  status: string,
): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "running":
      return "default";
    case "finalizing":
      return "secondary";
    case "queued":
    case "paused":
      return "secondary";
    case "completed":
      return "outline";
    case "incomplete":
      return "outline";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
};

const formatDuration = (ms: number | null): string => {
  if (!ms) return "-";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

const formatDate = (date: string | Date | null): string => {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getElapsedDuration = (
  startedAt: string | Date | null,
  now: number,
): string => {
  if (!startedAt) return "-";
  const start =
    typeof startedAt === "string" ? new Date(startedAt) : startedAt;
  const elapsed = now - start.getTime();
  return formatDuration(elapsed);
};

const formatTokens = (tokens: number | null): string => {
  if (tokens === null || tokens === undefined) return "-";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return tokens.toString();
};

const formatCost = (cost: string | null): string => {
  if (!cost) return "-";
  const num = parseFloat(cost);
  if (isNaN(num)) return "-";
  return `$${num.toFixed(2)}`;
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <Badge
    variant={statusBadgeVariant(status)}
    className={status === "running"
      ? "animate-pulse"
      : status === "incomplete"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : status === "paused"
          ? "border-orange-200 bg-orange-50 text-orange-700"
          : ""}
  >
    {status}
  </Badge>
);

const WorkItemLink: React.FC<{ workItemId: string | null }> = ({
  workItemId,
}) => {
  if (!workItemId) return <span>-</span>;

  return (
    <Link
      href={`/board?workItem=${workItemId}`}
      className="text-primary font-mono text-xs hover:underline"
    >
      {workItemId.slice(0, 8)}
    </Link>
  );
};

const PrLink: React.FC<{
  prUrl: string | null;
  prNumber: number | null;
}> = ({ prUrl, prNumber }) => {
  if (!prUrl) return <span className="text-muted-foreground">-</span>;

  return (
    <a
      href={prUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
    >
      #{prNumber}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
};

const StatsLoadingSkeleton: React.FC = () => (
  <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
    {Array.from({ length: 5 }).map((_, i) => (
      <Card key={i}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-4" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-12" />
        </CardContent>
      </Card>
    ))}
  </div>
);

const EmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <Bot className="text-muted-foreground mb-4 h-12 w-12" />
    <h3 className="text-lg font-semibold">No agent jobs yet</h3>
    <p className="text-muted-foreground mt-1 max-w-md text-sm">
      Agent jobs will appear here when work items are sent for AI
      implementation. Use the board view to dispatch jobs to agents.
    </p>
  </div>
);

const ActiveJobRow: React.FC<{ job: AgentJob; currentTime: number }> = ({
  job,
  currentTime,
}) => (
  <TableRow>
    <TableCell>
      <WorkItemLink workItemId={job.workItemId} />
    </TableCell>
    <TableCell>
      <Badge variant="outline" className="text-xs">
        {job.provider}
      </Badge>
    </TableCell>
    <TableCell>
      <StatusBadge status={job.status} />
    </TableCell>
    <TableCell className="tabular-nums">
      {job.status === "running" || job.status === "finalizing"
        ? getElapsedDuration(job.startedAt, currentTime)
        : "-"}
    </TableCell>
    <TableCell>
      {job.branchName ? (
        <span className="text-muted-foreground inline-flex items-center gap-1 font-mono text-xs">
          <GitBranch className="h-3 w-3" />
          {job.branchName.length > 30
            ? `${job.branchName.slice(0, 30)}...`
            : job.branchName}
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">-</span>
      )}
    </TableCell>
    <TableCell>
      <PrLink prUrl={job.prUrl} prNumber={job.prNumber} />
    </TableCell>
    <TableCell className="text-muted-foreground text-xs">
      {formatDate(job.startedAt ?? job.createdAt)}
    </TableCell>
  </TableRow>
);

const RecentJobRow: React.FC<{ job: AgentJob }> = ({ job }) => (
  <TableRow>
    <TableCell>
      <WorkItemLink workItemId={job.workItemId} />
    </TableCell>
    <TableCell>
      <Badge variant="outline" className="text-xs">
        {job.provider}
      </Badge>
    </TableCell>
    <TableCell>
      <StatusBadge status={job.status} />
    </TableCell>
    <TableCell className="tabular-nums">
      {formatDuration(job.durationMs)}
    </TableCell>
    <TableCell>
      <PrLink prUrl={job.prUrl} prNumber={job.prNumber} />
    </TableCell>
    <TableCell className="tabular-nums text-xs">
      {formatTokens(job.tokensUsed)}
    </TableCell>
    <TableCell className="tabular-nums text-xs">
      {formatCost(job.cost)}
    </TableCell>
    <TableCell className="text-muted-foreground text-xs">
      {formatDate(job.completedAt)}
    </TableCell>
  </TableRow>
);

export const AgentExecutionDashboard: React.FC<AgentDashboardProps> = ({
  stats,
  activeJobs,
  recentJobs,
  isLoading,
  currentTime,
  showRecentJobs = true,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <StatsLoadingSkeleton />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const visibleRecentJobs = showRecentJobs ? recentJobs : [];
  const hasNoJobs = activeJobs.length === 0 && visibleRecentJobs.length === 0;

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Running</CardTitle>
            <Activity className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.running}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Queued</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.queued}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Completed (24h)
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completedLast24h}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Incomplete (24h)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.incompleteLast24h}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed (24h)</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.failedLast24h}</div>
          </CardContent>
        </Card>
      </div>

      {hasNoJobs ? (
        <EmptyState />
      ) : (
        <>
          {/* Active jobs table */}
          {activeJobs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active Jobs</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Work Item</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>PR</TableHead>
                      <TableHead>Started</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeJobs.map((job) => (
                      <ActiveJobRow
                        key={job.id}
                        job={job}
                        currentTime={currentTime}
                      />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Recent jobs table */}
          {visibleRecentJobs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Jobs</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Work Item</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>PR</TableHead>
                      <TableHead>Tokens</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>Completed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRecentJobs.map((job) => (
                      <RecentJobRow key={job.id} job={job} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};
