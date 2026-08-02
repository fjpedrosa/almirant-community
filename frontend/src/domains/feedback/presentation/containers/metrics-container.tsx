"use client";

import {
  Inbox,
  CheckCircle2,
  Zap,
  Clock,
  TrendingUp,
  Bug,
  Hash,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFeedbackMetrics } from "../../application/hooks/use-feedback-metrics";
import { KpiCard } from "../components/kpi-card";
import { MetricsGrid } from "../components/metrics-grid";

const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
};

const formatPercentage = (ratio: number): string => {
  return `${(ratio * 100).toFixed(1)}%`;
};

export const MetricsContainer: React.FC = () => {
  const { data, isLoading, isError, error, refetch } = useFeedbackMetrics();

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Failed to load metrics: {error?.message ?? "Unknown error"}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <MetricsGrid>
        {Array.from({ length: 8 }).map((_, i) => (
          <KpiCard
            key={i}
            label=""
            value=""
            icon={null}
            isLoading
          />
        ))}
      </MetricsGrid>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">No metrics data available</p>
      </div>
    );
  }

  const kpis = [
    {
      label: "Inbox Size",
      value: data.inboxSize.toLocaleString(),
      icon: <Inbox className="size-4 text-primary" />,
    },
    {
      label: "Triaged Today",
      value: data.itemsTriagedToday.toLocaleString(),
      icon: <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />,
    },
    {
      label: "Auto-Assignment Rate",
      value: formatPercentage(data.autoAssignmentRate),
      icon: <Zap className="size-4 text-yellow-600 dark:text-yellow-400" />,
    },
    {
      label: "Avg. Triage Time",
      value: formatDuration(data.avgTriageTime),
      icon: <Clock className="size-4 text-blue-600 dark:text-blue-400" />,
    },
    {
      label: "Promoted Today",
      value: data.itemsPromotedToday.toLocaleString(),
      icon: <TrendingUp className="size-4 text-purple-600 dark:text-purple-400" />,
    },
    {
      label: "Bug Fixes In Progress",
      value: data.bugFixesInProgress.toLocaleString(),
      icon: <Bug className="size-4 text-red-600 dark:text-red-400" />,
    },
    {
      label: "Topics Count",
      value: data.topicsCount.toLocaleString(),
      icon: <Hash className="size-4 text-orange-600 dark:text-orange-400" />,
    },
    {
      label: "Open Clusters",
      value: data.clustersOpen.toLocaleString(),
      icon: <FolderOpen className="size-4 text-cyan-600 dark:text-cyan-400" />,
    },
  ];

  return (
    <MetricsGrid>
      {kpis.map((kpi) => (
        <KpiCard
          key={kpi.label}
          label={kpi.label}
          value={kpi.value}
          icon={kpi.icon}
        />
      ))}
    </MetricsGrid>
  );
};
